import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ActionResult, BibTarget, Paper, PaperDraft, StorageAdapter } from "./core/types";
import { Library } from "./core/library";
import { moveOldPdfs, pdfLocation } from "./core/filing";
import { parseQuery, search, type SortBy } from "./core/search";
import { libraryToBibtex, paperToBibtex } from "./core/bibtex";
import { cite, CITE_STYLES, type CiteStyle } from "./core/cite";
import { TextIndex } from "./core/textsearch";
import { actions, allPlugins, importers, loadPluginFromUrl, lookups, storageProviders } from "./core/plugins";
import { exportSettings, importSettings, loadSettings, persistStorage, pluginUrls, saveSettings, storageConfig, type Settings } from "./core/settings";
import { matchPaperpilePdfs, PDF_DIR } from "./core/paperpile";
import { canFindOpenPdf, findOpenPdf, type OpenPdfOptions } from "./core/openpdf";
import { Reader } from "./reader/Reader";
import { AskPanel } from "./AskPanel";
import { ObsidianPanel } from "./ObsidianPanel";
import { QuestionDialog, type Question } from "./QuestionDialog";
import { OfflinePanel } from "./OfflinePanel";
import { WritingPanel } from "./WritingPanel";
import { CitationMap } from "./CitationMap";
import { FreshPanel } from "./FreshPanel";
import { ManuscriptPanel } from "./ManuscriptPanel";
import { EquationPanel } from "./EquationPanel";
import { SharedPanel } from "./SharedPanel";
import { CommandPalette, type Command } from "./CommandPalette";
import { InfoPanel, type InfoPage } from "./InfoPanel";
import { Welcome } from "./Welcome";
import { demoDrafts, isDemo, markDemoOffered, markWelcomed, wantsDemo, welcomed } from "./core/demo";
import { activeId, activeStorage, copyPapers, readInvite, sharedLibraries, type Invite } from "./core/shared";
import type { ManuscriptReport } from "./core/manuscript";
import { browserCache, offlineLimit, withOfflineCache, type OfflineStorage } from "./core/offline";
import { bookmarklet, CAPTURE_KEYS, capturedInput, isPdf, SHARED_FILES_KEY, takeSharedFiles } from "./core/capture";
import { fallbackTitle, identifierIn } from "./core/pdfid";
import { allFolders, cleanFolder, folderTree, type FolderNode } from "./core/folders";
import { renderMarkdown } from "./core/markdown";
import { useMath } from "./core/math";
import { defaultBibPath, folderTargets, papersInFolder, runBibSync } from "./core/bibsync";
import { githubStorage } from "./plugins/storage-github";
import { crossref } from "./plugins/lookup";
import { findDuplicates, findPublished, mergeInto, pickKeeper, type Published } from "./core/tidy";
import { annotationsPath } from "./core/annotations";
import { Icon, type IconName } from "./icons";
import { site } from "./core/site";

const library = new Library();

type SaveState = "idle" | "pending" | "saving" | "saved" | "merged" | "error" | "offline";

function download(name: string, text: string, type = "application/x-bibtex") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const pdfOptions = (s: Settings): OpenPdfOptions => ({ email: s["pdfs.email"]?.trim(), service: s["pdfs.service"]?.trim() || undefined });

/** Point papers at PDFs copied from Paperpile's Drive folder. Returns how many were linked. */
async function linkPaperpilePdfs(storage: StorageAdapter): Promise<number> {
  const unlinked = library.papers.filter((p) => p.file && !p.pdf);
  if (!unlinked.length) return 0;
  const keys = await (storage.listAll ?? storage.list).call(storage, PDF_DIR).catch(() => [] as string[]);
  const found = matchPaperpilePdfs(unlinked, keys);
  for (const [id, path] of found) library.update(id, { pdf: path });
  return found.size;
}

const shortAuthors = (p: { authors?: string[] }) => {
  const a = (p.authors ?? []).map((x) => x.split(",")[0]);
  return a.length > 3 ? `${a[0]} et al.` : a.join(", ");
};

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [storage, setStorage] = useState<StorageAdapter | null>(null);
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState("Opening your library…");
  const [where, setWhere] = useState<string | null>(null);
  const [seededNote, setSeededNote] = useState("");
  const [bibNote, setBibNote] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [tidying, setTidying] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortBy>("added");
  const [selected, setSelected] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [panel, setPanel] = useState<"add" | "settings" | "ask" | "obsidian" | "writing" | "map" | "fresh" | "manuscript" | "equation" | "shared" | "palette" | "info" | "offline" | null>(null);
  // PDFs kept on this device on purpose (Offline papers), by storage path.
  const [keptPdfs, setKeptPdfs] = useState<Map<string, number>>(new Map());
  const [infoPage, setInfoPage] = useState<InfoPage>("start");
  const [welcome, setWelcome] = useState(false);
  // A brand-new library in this browser gets an example paper once storage is open.
  const [demoPending, setDemoPending] = useState(false);
  const [readingPage, setReadingPage] = useState(0);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const [manuscriptReports, setManuscriptReports] = useState<Map<string, ManuscriptReport>>(new Map());
  const [checking, setChecking] = useState(false);
  // An invite to a shared library, from a link's ?join=.
  const [invite, setInvite] = useState<Invite | null>(() => readInvite(location.search));
  // A shared library whose owner gave this person read access only.
  const [readOnly, setReadOnly] = useState(false);
  const readOnlyRef = useRef(false);
  // A paper shared to Lightkone, or sent by the bookmarklet, waiting for storage to open.
  const [captured, setCaptured] = useState<string | null>(() => capturedInput(location.search));
  // PDF files shared to the installed app (kept by the service worker) or dropped on the window.
  const [sharedFiles, setSharedFiles] = useState<File[]>([]);

  // Open storage whenever the chosen provider or its settings change.
  const providerId = settings["storage.provider"] || "browser";
  // One's own library, or the shared library open now.
  const active = activeStorage(settings);
  const storageKey = JSON.stringify(active.config) + active.providerId + (active.shared?.id ?? "");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const url of pluginUrls(settings)) {
        try {
          await loadPluginFromUrl(url);
        } catch (e) {
          setError(`Could not load the plugin at ${url}: ${(e as Error).message}`);
        }
      }
      const provider = storageProviders().find((p) => p.id === active.providerId) ?? storageProviders()[0];
      try {
        const remote = provider.create(active.config);
        // This browser's own storage is already offline; others keep an offline copy, one per library.
        const adapter = provider.id === "browser" ? remote : withOfflineCache(remote, browserCache(active.shared ? `lightkone-offline-${active.shared.id}` : undefined));
        library.storage = adapter;
        setStatus(active.shared ? `Opening ${active.shared.name}…` : `Opening your library from ${provider.label}…`);
        const { loaded, seeded, foldered } = await library.load();
        if (cancelled) return;
        readOnlyRef.current = (await adapter.access?.()) === "read";
        if (cancelled) return;
        setReadOnly(readOnlyRef.current);
        setStorage(adapter);
        (adapter as Partial<OfflineStorage>).kept?.().then((m) => !cancelled && setKeptPdfs(m)) ?? setKeptPdfs(new Map());
        setWhere(active.shared ? `${active.shared.name} (shared${readOnlyRef.current ? ", read only" : ""})` : provider.label);
        const linked = await linkPaperpilePdfs(adapter);
        if (cancelled) return;
        const offline = (adapter as Partial<OfflineStorage>).offline;
        setSeededNote(
          [
            offline ? " · offline copy, changes won't save until you're back online" : "",
            seeded ? ` · ${seeded} new from .bib files` : "",
            linked ? ` · ${linked} PDF${linked > 1 ? "s" : ""} linked from Paperpile` : "",
            foldered ? ` · ${foldered} paper${foldered > 1 ? "s" : ""} put in folders from Paperpile` : "",
          ].join(""),
        );
        if (!readOnlyRef.current) movePdfs(adapter);
        if (seeded || linked || foldered) {
          scheduleSave();
        } else if (library.bibSync.some((t) => t.tex !== undefined) && syncToken()) {
          // A manuscript may have changed since: bring its .bib in step.
          syncBibs();
        } else if (!loaded && !library.papers.length && !captured && !invite) {
          if (wantsDemo({ provider: provider.id, shared: Boolean(active.shared), loaded, papers: library.papers.length, arriving: false })) setDemoPending(true);
          if (welcomed()) setPanel("add");
          else setWelcome(true);
        }
      } catch (e) {
        if (cancelled) return;
        library.storage = null;
        library.papers = [];
        setStorage(null);
        setWhere(null);
        setStatus("Not connected");
        setError(`Could not open ${active.shared ? active.shared.name : provider.label}: ${(e as Error).message}`);
        setPanel(active.shared ? "shared" : "settings");
      }
      setVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey, settings["plugins.urls"]]);

  useEffect(() => library.onChange(() => setVersion((v) => v + 1)), []);

  // The text inside each PDF, for search: loaded once per library, then kept in this browser.
  const [textVersion, setTextVersion] = useState(0);
  const textIndex = useMemo(() => (storage ? new TextIndex(storage, storageKey) : null), [storage]);
  useEffect(() => void textIndex?.load(() => setTextVersion((v) => v + 1)), [textIndex]);
  const [indexing, setIndexing] = useState<AbortController | null>(null);
  async function indexPdfs() {
    if (!textIndex) return;
    if (indexing) return indexing.abort();
    const stop = new AbortController();
    setIndexing(stop);
    try {
      const { extractText } = await import("./reader/view");
      const n = await textIndex.indexPdfs(library.papers, extractText, (done, total) => {
        setBusy(`Reading PDFs for search: ${done} of ${total}`);
        if (done % 10 === 0) setTextVersion((v) => v + 1);
      }, stop.signal);
      setBusy(null);
      setTextVersion((v) => v + 1);
      if (!stop.signal.aborted) setError(null);
    } finally {
      setIndexing(null);
      setBusy(null);
    }
  }

  /** Open a paper at a page from a panel; the panel waits underneath the reader. */
  function openAt(id: string, page: number) {
    const p = library.papers.find((x) => x.id === id);
    if (!p) return;
    setSelected(id);
    if (p.pdf && storage) {
      library.update(id, { opened: new Date().toISOString() });
      scheduleSave();
      setReadingPage(page);
      setReading(id);
    } else setPanel(null);
  }

  useEffect(() => {
    if (!storage || !demoPending) return;
    setDemoPending(false);
    markDemoOffered();
    addDrafts(demoDrafts());
  }, [storage, demoPending]);
  const demos = library.papers.filter((p) => isDemo(p) && !p.trashed);
  const demo = demos[0];

  function closeWelcome() {
    markWelcomed();
    setWelcome(false);
  }

  // A link from an exported note, ?open=<paper id>&page=<n>, opens that paper at that page.
  useEffect(() => {
    if (!storage) return;
    const url = new URL(location.href);
    const id = url.searchParams.get("open");
    if (!id) return;
    const p = library.papers.find((x) => x.id === id);
    if (p) {
      setSelected(p.id);
      const page = Number(url.searchParams.get("page")) || 0;
      if (page && p.pdf) {
        setReadingPage(page);
        setReading(p.id);
      }
    }
    url.searchParams.delete("open");
    url.searchParams.delete("page");
    history.replaceState(null, "", url);
  }, [storage]);

  // PDFs shared to the app wait in the service worker's cache until the app opens.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has(SHARED_FILES_KEY)) return;
    takeSharedFiles().then((files) => files.length && setSharedFiles(files));
  }, []);
  // Dropping PDFs anywhere on the window adds them.
  useEffect(() => {
    const isFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const over = (e: DragEvent) => { if (isFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      const pdfs = [...(e.dataTransfer?.files ?? [])].filter(isPdf);
      if (!pdfs.length || (e.target as HTMLElement).closest?.(".reader")) return;
      e.preventDefault();
      setSharedFiles(pdfs);
    };
    addEventListener("dragover", over);
    addEventListener("drop", drop);
    return () => { removeEventListener("dragover", over); removeEventListener("drop", drop); };
  }, []);
  useEffect(() => {
    if (sharedFiles.length && storage) setPanel("add");
  }, [sharedFiles, storage]);

  // Once storage is open, hand a captured paper to the Add panel and tidy the address bar.
  useEffect(() => {
    if (!captured || !storage) return;
    setPanel("add");
    const url = new URL(location.href);
    CAPTURE_KEYS.forEach((k) => url.searchParams.delete(k));
    history.replaceState(null, "", url);
  }, [captured, storage]);
  useEffect(() => {
    if (!new URLSearchParams(location.search).has(SHARED_FILES_KEY)) return;
    const url = new URL(location.href);
    url.searchParams.delete(SHARED_FILES_KEY);
    history.replaceState(null, "", url);
  }, []);

  /** Libraries from before papers/ keep PDFs under Paperpile/All Papers/: move them, once. */
  async function movePdfs(adapter: StorageAdapter) {
    try {
      const { repointed, removeOld } = await moveOldPdfs(adapter, library.papers, (done, total) => setSeededNote(` · moving PDFs to papers/ (${done} of ${total})`));
      for (const [id, pdf] of repointed) library.update(id, { pdf });
      // Papers from Paperpile's .bib find PDFs that were only now moved.
      const linked = await linkPaperpilePdfs(adapter);
      if (repointed.size || linked) await library.save();
      await removeOld();
      if (repointed.size || linked) setSeededNote(` · PDFs moved to papers/${linked ? `, ${linked} linked` : ""}`);
    } catch (e) {
      setError(`Could not move PDFs to papers/: ${(e as Error).message}. Nothing was removed; it will try again next time.`);
    }
  }

  function scheduleSave() {
    if (readOnlyRef.current) {
      setError("You can read this shared library but not change it. Its owner can give you write access where it lives.");
      return;
    }
    setSaveState("pending");
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        setSaveState((await library.save()) ? "merged" : "saved");
      } catch (e) {
        if (navigator.onLine === false || (e instanceof TypeError && /fetch|network|load failed/i.test(e.message))) {
          setSaveState("offline");
          if (!offlineWarned.current) setError("No network: changes will be saved when you're back online, so keep Lightkone open until then. Highlights are kept on this device either way.");
          offlineWarned.current = true;
        } else {
          setSaveState("error");
          setError(`Could not save: ${(e as Error).message}`);
        }
        return;
      }
      if (library.bibSync.length) syncBibs();
    }, 1200);
  }

  const syncToken = () => settings["bibsync.token"] || (providerId === "github" ? settings["storage.github.token"] : "") || "";
  async function syncBibs() {
    const token = syncToken();
    if (!token) return setError("BibTeX sync needs a GitHub token: add one under Settings → BibTeX sync to GitHub.");
    const api = settings["storage.github.api"] || undefined;
    setChecking(true);
    const r = await runBibSync(library.bibSync, library.papers, (t) => githubStorage({ repo: t.repo, branch: t.branch, token, api })).finally(() => setChecking(false));
    if (r.manuscripts.size) setManuscriptReports((old) => new Map([...old, ...r.manuscripts]));
    if (r.errors.length) setError(`BibTeX sync failed for ${r.errors.join("; ")}`);
    if (r.written.length) setBibNote(` · .bib synced to ${r.written.join(", ")}`);
  }

  // A link to join a shared library opens the panel to join it, then leaves the address.
  useEffect(() => {
    if (!invite) return;
    setPanel("shared");
    const url = new URL(location.href);
    url.searchParams.delete("join");
    history.replaceState(null, "", url);
  }, []);

  /** Where each library lives, to copy papers between them. */
  const otherLibraries = () => [
    ...(active.shared ? [{ id: "", name: "My library" }] : []),
    ...sharedLibraries(settings).filter((l) => l.id !== active.shared?.id).map((l) => ({ id: l.id, name: l.name })),
  ];
  async function copyTo(target: string, papers: Paper[]) {
    if (!storage) return;
    const l = sharedLibraries(settings).find((x) => x.id === target);
    const pid = l ? l.provider : providerId;
    const provider = storageProviders().find((p) => p.id === pid);
    if (!provider) return setError("That library's storage is not available here.");
    setBusy(`Copying to ${l ? l.name : "your library"}`);
    try {
      const to = provider.create(l ? l.config : storageConfig(settings, pid));
      if ((await to.access?.()) === "read") throw new Error("you can only read that library");
      const n = await copyPapers(papers, storage, to, l ? settings["profile.name"]?.trim() || undefined : undefined);
      setBibNote(` · ${n ? `copied to ${l ? l.name : "your library"}` : "already there"}`);
    } catch (e) {
      setError(`Could not copy: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  // Coming back to the tab, take in what was saved on another device or by Claude meanwhile.
  useEffect(() => {
    if (!storage) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      library.refresh().then((n) => n && setSaveState((s) => (s === "pending" || s === "saving" ? s : "merged")), () => {});
      if (library.bibSync.some((t) => t.tex !== undefined) && syncToken()) syncBibs();
    };
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [storage]);

  // Warn before closing with unsaved changes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === "pending" || saveState === "saving" || saveState === "offline") e.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [saveState]);

  const words = useMemo(() => parseQuery(query).words, [query]);
  const visible = useMemo(
    () => search(library.papers, query, sort, textIndex ? (id, w) => textIndex.hit(id, w) !== null : undefined),
    [version, query, sort, textVersion, textIndex],
  );
  const unindexed = useMemo(() => (textIndex && words.length ? textIndex.missing(library.papers).length : 0), [textIndex, textVersion, version, words.length > 0]);
  const tags = useMemo(() => library.tagCounts(), [version]);
  const tree = useMemo(() => folderTree(library.papers), [version]);
  const counts = useMemo(() => {
    const live = library.papers.filter((p) => !p.trashed);
    return { all: live.length, starred: live.filter((p) => p.starred).length, recent: live.filter((p) => p.opened).length, trash: library.papers.length - live.length };
  }, [version]);
  const [tagFilter, setTagFilter] = useState("");
  // On a phone the sidebar is a drawer; picking something in it closes it.
  const [sideOpen, setSideOpen] = useState(false);
  const pick = (q: string) => {
    setQuery(q);
    setSideOpen(false);
  };
  const [allTags, setAllTags] = useState(false);
  // Big imported libraries carry hundreds of publisher keywords: show the most used first.
  const matchingTags = useMemo(
    () => (tagFilter ? tags.filter(([t]) => t.toLowerCase().includes(tagFilter.toLowerCase())) : tags),
    [tags, tagFilter],
  );
  const shownTags = useMemo(() => {
    if (allTags || tagFilter || matchingTags.length <= 40) return matchingTags;
    const top = new Set([...matchingTags].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t));
    return matchingTags.filter(([t]) => top.has(t));
  }, [matchingTags, allTags, tagFilter]);
  const paper = library.papers.find((p) => p.id === selected) ?? null;
  const searchRef = useRef<HTMLInputElement>(null);

  // Keys: "/" searches, j and k move through the list, Escape closes the paper.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (panel || welcome || tidying || syncing !== null || reading || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "?") {
        e.preventDefault();
        setInfoPage("start");
        setPanel("info");
      } else if (e.key === "Escape" && selected) {
        setSelected(null);
      } else if (e.key === "j" || e.key === "k") {
        const shown = visible.slice(0, 500);
        if (!shown.length) return;
        const i = shown.findIndex((p) => p.id === selected);
        const next = shown[Math.max(0, Math.min(shown.length - 1, i < 0 ? 0 : i + (e.key === "j" ? 1 : -1)))];
        setSelected(next.id);
        setResult(null);
        document.querySelector(`.papers li:nth-child(${shown.indexOf(next) + 1})`)?.scrollIntoView({ block: "nearest" });
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [visible, selected, panel, welcome, tidying, syncing, reading]);

  // Ctrl/⌘ K opens the command palette from anywhere but the reader.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "k" || reading) return;
      e.preventDefault();
      setSideOpen(false);
      setPanel((p) => (p === "palette" ? null : "palette"));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [reading]);

  function updateSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
    persistStorage();
  }

  function addDrafts(drafts: PaperDraft[], fetchPdfs = true): Paper[] {
    if (readOnlyRef.current) {
      scheduleSave();
      return [];
    }
    // In a shared library, papers say who added them.
    const by = active.shared && settings["profile.name"]?.trim();
    const { added, updated } = library.merge(by ? drafts.map((d) => ({ by, ...d })) : drafts);
    if (added.length || updated.length) scheduleSave();
    // Fetch free PDFs in the background; a big .bib import is left alone.
    if (fetchPdfs && settings["pdfs.auto"] !== "off" && added.length <= 20) added.forEach((p) => getPdf(p, true));
    return added;
  }

  /** Add a paper with its PDF file; a paper already in the library gets the PDF if it has none. */
  async function addWithPdf(draft: PaperDraft, bytes: Uint8Array): Promise<"added" | "attached" | "had"> {
    const added = addDrafts([draft], false);
    const p = added[0] ?? library.findDuplicate(draft);
    if (!storage || !p) throw new Error("Could not add it to the library.");
    if (p.pdf) return "had";
    const where = pdfLocation(p, library.papers);
    await storage.write(where.pdf, bytes, "application/pdf");
    library.update(p.id, where);
    scheduleSave();
    if (added.length) setSelected(p.id);
    return added.length ? "added" : "attached";
  }

  /** Download a free PDF into storage. Quiet when it runs on its own. */
  async function getPdf(p: Paper, quiet = false): Promise<boolean> {
    if (!storage || p.pdf || !canFindOpenPdf(p, pdfOptions(settings))) return false;
    if (!quiet) setBusy("Looking for a free PDF");
    try {
      const bytes = await findOpenPdf(p, pdfOptions(settings));
      if (!bytes) {
        if (!quiet) setError(`No free PDF found for "${p.title}".`);
        return false;
      }
      const { pdf, file } = pdfLocation(p, library.papers);
      await storage.write(pdf, bytes, "application/pdf");
      library.update(p.id, { pdf, file });
      scheduleSave();
      return true;
    } catch (e) {
      if (!quiet) setError(`Could not get the PDF: ${(e as Error).message}`);
      return false;
    } finally {
      if (!quiet) setBusy(null);
    }
  }

  async function runAction(id: string, p: Paper) {
    const action = actions().find((a) => `${a.plugin}.${a.id}` === id);
    if (!action) return;
    setLastAction(id);
    setBusy(action.label);
    setError(null);
    try {
      const r = await action.run(p, {
        settings,
        storage,
        library: library.papers,
        open: (url) => window.open(url, "_blank", "noopener"),
        ask: (title, placeholder) =>
          new Promise((resolve) => {
            setBusy(null);
            setQuestion({
              title,
              placeholder,
              answer: (text) => {
                setQuestion(null);
                if (text) setBusy(action.label);
                resolve(text);
              },
            });
          }),
      });
      if (r.kind !== "none") setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const about = (page: InfoPage) => () => {
    setSideOpen(false);
    setInfoPage(page);
    setPanel("info");
  };
  const go = (p: NonNullable<typeof panel>) => () => {
    setSideOpen(false);
    setPanel(p);
  };
  // The tools, by group: listed in the sidebar and found by the command palette.
  const hasPapers = library.papers.length > 0;
  const offlineStore = storage && "keep" in storage ? (storage as OfflineStorage) : null;
  // Back online: write highlights made offline, and changes that couldn't be saved.
  const offlineWarned = useRef(false);
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  useEffect(() => {
    if (!offlineStore) return;
    const back = () => {
      offlineStore.flush().catch(() => {});
      offlineWarned.current = false;
      if (saveStateRef.current === "error" || saveStateRef.current === "offline") scheduleSave();
    };
    if (navigator.onLine !== false) back();
    addEventListener("online", back);
    return () => removeEventListener("online", back);
  }, [offlineStore]);
  async function keepOffline(papers: Paper[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<string> {
    if (!offlineStore) return "";
    navigator.storage?.persist?.().catch(() => {});
    const withPdf = papers.filter((p) => p.pdf);
    const r = await offlineStore.keep(withPdf.map((p) => p.pdf!), offlineLimit(), onProgress, signal);
    // Highlights and notes come along, so they show offline too.
    for (const p of withPdf) await offlineStore.read(annotationsPath(p.id)).catch(() => null);
    setKeptPdfs(await offlineStore.kept());
    return [
      `Kept ${r.added} ${r.added === 1 ? "paper" : "papers"} on this device.`,
      r.failed ? `${r.failed} could not be downloaded; try again when the connection is better.` : "",
      r.full ? "Stopped at the space limit: raise it, or remove some papers." : "",
      signal?.aborted ? "Stopped." : "",
    ].filter(Boolean).join(" ");
  }
  async function releaseOffline(paths: string[]) {
    if (!offlineStore) return;
    await offlineStore.release(paths);
    setKeptPdfs(await offlineStore.kept());
  }

  const tools: Tool[] = [
    { id: "fresh", group: "Discover", label: "New on arXiv", icon: "sparkle", hint: "Each day's arXiv preprints near your library", show: Boolean(storage && hasPapers), run: go("fresh") },
    { id: "map", group: "Discover", label: "Citation map", icon: "link", hint: "Which of your papers cite which, and what they cite that you don't have", show: Boolean(storage && hasPapers), run: go("map") },
    { id: "equation", group: "Discover", label: "Search by equation", icon: "sigma", hint: "Find the papers that use an equation", show: Boolean(storage && library.papers.some((p) => p.arxiv)), run: go("equation") },
    { id: "writing", group: "Write", label: "Writing helpers", icon: "book", hint: "What to cite for a sentence; a .bib for a manuscript", show: hasPapers, run: go("writing") },
    { id: "manuscript", group: "Write", label: "Watch my manuscript", icon: "sync", hint: "Keep a LaTeX manuscript's .bib in step with what it cites", show: Boolean(storage), run: go("manuscript") },
    { id: "obsidian", group: "Write", label: "Export to Obsidian", icon: "file", hint: "Highlights and notes as Markdown notes", show: Boolean(storage), run: go("obsidian") },
    { id: "tidy", group: "Organize", label: "Tidy up", icon: "broom", hint: "Duplicates, published versions of preprints", show: Boolean(storage), run: () => { setTidying(true); setSideOpen(false); } },
    { id: "offline", group: "Organize", label: "Offline papers", icon: "download", hint: "Choose PDFs to keep on this device, for reading with no network", show: Boolean(offlineStore && library.papers.some((p) => p.pdf)), run: go("offline") },
    { id: "shared", group: "Organize", label: "Shared libraries", icon: "users", hint: "Libraries shared with a group", show: true, run: go("shared") },
  ].filter((t) => t.show) as Tool[];
  const commands: Command[] = [
    ...(storage && !readOnly ? [{ id: "add", group: "Actions", label: "Add paper", icon: "plus", keywords: "new import arxiv doi bibtex", run: () => setPanel("add") } as Command] : []),
    ...(hasPapers ? [{ id: "ask", group: "Actions", label: "Ask your library", icon: "sparkle", keywords: "question claude ai", run: () => setPanel("ask") } as Command] : []),
    { id: "search", group: "Actions", label: "Search the library", icon: "search", keywords: "find filter", run: () => setTimeout(() => searchRef.current?.focus()) },
    ...(visible.length ? [{ id: "bib", group: "Actions", label: "Export papers in view as .bib", icon: "download", keywords: "bibtex download", run: () => download("library.bib", libraryToBibtex(visible)) } as Command] : []),
    { id: "theme", group: "Actions", label: `Theme: ${THEME_NAMES[nextTheme(currentTheme())]}`, icon: "moon", hint: `Now: ${THEME_NAMES[currentTheme()]}`, keywords: "dark light mode appearance", run: () => chooseTheme(nextTheme(currentTheme())) },
    { id: "settings", group: "Actions", label: "Settings", icon: "settings", keywords: "storage key preferences claude openalex", run: () => setPanel("settings") },
    { id: "help:start", group: "Help", label: "Help: start here", icon: "help", keywords: "getting started intro onboarding", run: about("start") },
    { id: "help:guide", group: "Help", label: "Guide: how to do things", icon: "help", keywords: "help howto manual faq", run: about("guide") },
    { id: "help:docs", group: "Help", label: "Documentation", icon: "book", keywords: "docs manual paperpile migrate storage r2 s3 github", run: () => window.open("../docs/", "_blank", "noopener") },
    { id: "help:paperpile", group: "Help", label: "Moving from Paperpile", icon: "book", keywords: "docs import migrate bibtex", run: () => window.open("../docs/paperpile.html", "_blank", "noopener") },
    { id: "help:tour", group: "Help", label: "Welcome tour", icon: "help", keywords: "onboarding intro help", run: () => { setSideOpen(false); setWelcome(true); } },
    { id: "about:how", group: "Help", label: "How Lightkone works", icon: "info", keywords: "about storage server", run: about("how") },
    { id: "about:data", group: "Help", label: "Your data: what is processed where", icon: "info", keywords: "privacy about", run: about("data") },
    { id: "about:keys", group: "Help", label: "Keyboard shortcuts", icon: "info", keywords: "keys help", run: about("keys") },
    ...tools.map((t) => ({ id: t.id, group: t.group, label: t.label, icon: t.icon, hint: t.hint, run: t.run })),
    ...(
      [
        ["", "All papers", "library"],
        ["is:starred", "Starred", "star"],
        ["is:recent", "Recently read", "clock"],
        ...(counts.trash ? [["is:trash", "Trash", "trash"]] : []),
      ] as [string, string, IconName][]
    ).map(([q, label, icon]) => ({ id: `view:${q}`, group: "Go to", label, icon, run: () => pick(q) })),
    ...allFolders(library.papers.filter((p) => !p.trashed)).map((f) => ({ id: `in:${f}`, group: "Folders", label: f, icon: "folder" as IconName, onlyWhenTyped: true, run: () => pick(`in:"${f}"`) })),
    ...tags.map(([t, n]) => ({ id: `tag:${t}`, group: "Tags", label: t, icon: "tag" as IconName, hint: `${n} ${n === 1 ? "paper" : "papers"}`, onlyWhenTyped: true, run: () => pick(`tag:"${t}"`) })),
  ];

  const saveLabel = { idle: "", pending: "Unsaved", saving: "Saving…", saved: "Saved", merged: "Synced", error: "Not saved", offline: "Offline, saves later" }[saveState];
  const view = viewTitle(query);

  return (
    <div class={`app ${paper ? "has-detail" : ""}`}>
      <header class="top">
        <button class="icon-btn browse" onClick={() => setSideOpen(!sideOpen)} aria-expanded={sideOpen} aria-label="Folders and tags">
          <Icon name="menu" />
        </button>
        <div class="brand">
          <img class="logo" src="../icon.svg" alt="" />
          <span class="brand-name">Lightkone</span>
        </div>
        <label class="search">
          <Icon name="search" />
          <input
            ref={searchRef}
            type="search"
            placeholder='Search, or tag:"…" author:… year:2019-2021'
            aria-label="Search the library"
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Escape" && (setQuery(""), e.currentTarget.blur())}
          />
          {!query && <kbd>/</kbd>}
        </label>
        <div class="top-actions">
          {saveLabel && (
            <span class={`save ${saveState}`} role="status" aria-label={saveLabel} title={saveState === "merged" ? "Merged with changes saved on another device or by Claude" : saveLabel}>
              {saveState === "saved" && <Icon name="check" size={14} />}
              {saveState === "merged" && <Icon name="sync" size={14} />}
              <span class="save-text">{saveLabel}</span>
            </span>
          )}
          <button class="icon-btn" onClick={() => setPanel("palette")} title={`Find a tool, folder, tag or paper (${MOD}K)`} aria-label="Commands">
            <Icon name="command" />
          </button>
          <button class="ask-btn" onClick={() => setPanel("ask")} disabled={!library.papers.length} title="Ask a question across your library">
            <Icon name="sparkle" />
            <span class="label">Ask</span>
          </button>
          <button class="primary add" onClick={() => setPanel("add")} disabled={!storage || readOnly} title={readOnly ? "This shared library is read only for you" : undefined}>
            <Icon name="plus" />
            <span class="label">Add paper</span>
          </button>
          <button class="icon-btn hide-phone" onClick={() => download("library.bib", libraryToBibtex(visible))} disabled={!visible.length} title="Export the papers in view as BibTeX" aria-label="Export .bib">
            <Icon name="download" />
          </button>
          <ThemeButton class="hide-phone" />
          <button class="icon-btn" onClick={about("start")} title="Help (?)" aria-label="Help">
            <Icon name="help" />
          </button>
          <button class="icon-btn" onClick={() => setPanel("settings")} title="Settings" aria-label="Settings">
            <Icon name="settings" />
          </button>
        </div>
      </header>

      {sideOpen && <div class="side-backdrop" onClick={() => setSideOpen(false)} />}
      <aside class={`side ${sideOpen ? "open" : ""}`}>
        {sharedLibraries(settings).length > 0 && (
          <label class="library-switch">
            <span class="sr-only">Library</span>
            <select
              value={activeId(settings)}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v === "manage") return setPanel("shared");
                setSelected(null);
                setQuery("");
                updateSettings({ ...settings, "libraries.active": v });
              }}
            >
              <option value="">My library</option>
              {sharedLibraries(settings).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              <option value="manage">Shared libraries…</option>
            </select>
          </label>
        )}
        <nav class="nav">
          {(
            [
              ["", "All papers", counts.all, "library"],
              ["is:starred", "Starred", counts.starred, "star"],
              ["is:recent", "Recently read", counts.recent, "clock"],
              ["is:trash", "Trash", counts.trash, "trash"],
            ] as const
          ).map(([q, label, n, icon]) =>
            q === "is:trash" && !n && query !== q ? null : (
              <button key={label} class={`tag ${query === q ? "on" : ""}`} onClick={() => pick(q)}>
                <Icon name={icon} />
                <span class="name">{label}</span>
                <span class="count">{n}</span>
              </button>
            ),
          )}
        </nav>
        <button class="tag find-tool" onClick={() => { setSideOpen(false); setPanel("palette"); }} title="Find any tool, folder, tag or paper">
          <Icon name="command" />
          <span class="name">Find a tool…</span>
          <kbd class="hide-phone">{MOD}K</kbd>
        </button>
        <ToolGroups tools={tools} />
        <h3>Folders</h3>
        {!tree.length && <p class="muted small hint">Put a paper in a folder from its details; folders can nest, like "Physics/QFT".</p>}
        <FolderList nodes={tree} query={query} onPick={pick} />
        <h3>Tags</h3>
        {tags.length === 0 && <p class="muted small hint">Tags from your papers show here.</p>}
        {tags.length > 30 && (
          <input class="tag-filter" placeholder={`Filter ${tags.length} tags`} value={tagFilter} onInput={(e) => setTagFilter(e.currentTarget.value)} />
        )}
        <div class="tag-cloud">
          {shownTags.map(([t, n]) => {
            const q = `tag:"${t}"`;
            return (
              <button key={t} class={`pill ${query === q ? "on" : ""}`} onClick={() => pick(query === q ? "" : q)}>
                {t} <span>{n}</span>
              </button>
            );
          })}
        </div>
        {shownTags.length < matchingTags.length && (
          <button class="link small more" onClick={() => setAllTags(true)}>
            Show all {matchingTags.length} tags
          </button>
        )}
        <footer class="side-foot">
          <div class="side-status">
            <Icon name="cloud" size={15} />
            <span>{where ? `${where}${seededNote}${bibNote}` : status}</span>
          </div>
          <nav class="side-links" aria-label="Help">
            <button class="link" onClick={about("start")}>Help</button>
            <button class="link" onClick={about("guide")}>Guide</button>
            <a class="link" href="../docs/" target="_blank" rel="noopener">Docs</a>
            <button class="link" onClick={about("how")}>How it works</button>
            <button class="link" onClick={about("data")}>Your data</button>
            <button class="link" onClick={about("keys")}>Shortcuts</button>
          </nav>
        </footer>
      </aside>

      <main class="list">
        <div class="list-head">
          <div class="view">
            <h1>{view}</h1>
            <span class="muted">
              {visible.length} {visible.length === 1 ? "paper" : "papers"}
            </span>
          </div>
          <div class="list-tools">
            {query === "is:trash" && visible.length > 0 && (
              <button
                class="small danger-btn"
                onClick={() => {
                  if (!confirm(`Delete ${visible.length} paper${visible.length > 1 ? "s" : ""} in the trash for good? Their PDFs stay in storage.`)) return;
                  visible.forEach((p) => library.remove(p.id));
                  setSelected(null);
                  scheduleSave();
                }}
              >
                Empty trash
              </button>
            )}
            {storage && (query === "" || /^in:"[^"]+"$/.test(query)) && (
              <button
                class="small"
                title="Keep a .bib of these papers in a GitHub repository, for Overleaf"
                onClick={() => setSyncing(query ? query.slice(4, -1) : "")}
              >
                <Icon name="sync" size={15} />
                {folderTargets(library.bibSync, query ? query.slice(4, -1) : "").length ? "Syncing .bib" : "Sync .bib"}
              </button>
            )}
            <select value={sort} aria-label="Sort" onChange={(e) => setSort(e.currentTarget.value as SortBy)}>
              <option value="added">Recently added</option>
              <option value="year">Year</option>
              <option value="title">Title</option>
              <option value="relevance">Relevance</option>
              <option value="opened">Recently read</option>
            </select>
          </div>
        </div>
        {unindexed > 0 && (
          <p class="text-note muted small">
            {indexing ? "Reading your PDFs so their text can be searched." : `${unindexed} PDF${unindexed > 1 ? "s haven't" : " hasn't"} been read for search yet.`}{" "}
            <button class="link" onClick={indexPdfs}>{indexing ? "Stop" : "Read them now"}</button>
          </p>
        )}
        {demo && query !== "is:trash" && (
          <p class="text-note muted small">
            {demos.length > 1 ? "The two example papers are" : "The example paper is"} here to try things on: read, highlight, ask.{" "}
            <button
              class="link"
              onClick={() => {
                const now = new Date().toISOString();
                demos.forEach((p) => library.update(p.id, { trashed: now }));
                if (demos.some((p) => p.id === selected)) setSelected(null);
                scheduleSave();
              }}
            >
              {demos.length > 1 ? "Remove them" : "Remove it"}
            </button>
          </p>
        )}
        <ul class="papers">
          {visible.slice(0, 500).map((p) => (
            <li key={p.id} class={p.id === selected ? "on" : ""} onClick={() => { setSelected(p.id); setResult(null); }}>
              <button
                class={`star ${p.starred ? "on" : ""}`}
                aria-label={p.starred ? "Unstar" : "Star"}
                aria-pressed={Boolean(p.starred)}
                onClick={(e) => { e.stopPropagation(); library.update(p.id, { starred: !p.starred || undefined }); scheduleSave(); }}
              >
                <Icon name="star" filled={Boolean(p.starred)} />
              </button>
              <div class="title">{p.title}</div>
              <div class="meta">
                <span>{shortAuthors(p)}</span>
                {p.year && <span>{p.year}</span>}
                {p.venue && <span class="venue">{p.venue}</span>}
              </div>
              {words.length > 0 && (() => {
                const hit = textIndex?.hit(p.id, words);
                return hit && <div class="snippet"><span class="page">p. {hit.page}</span> {hit.snippet}</div>;
              })()}
              {(p.pdf || p.tags.length > 0) && (
                <div class="chips">
                  {p.pdf && <span class="chip pdf">PDF</span>}
                  {p.pdf && keptPdfs.has(p.pdf) && <span class="chip offline" title="Kept on this device for reading offline">Offline</span>}
                  {p.tags.slice(0, 4).map((t) => (
                    <span class="chip" key={t}>{t}</span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        {visible.length > 500 && <p class="muted center">Showing the first 500. Search or pick a tag to narrow it down.</p>}
        {!visible.length && storage && (
          <div class="empty">
            <Icon name={library.papers.length ? "search" : "library"} size={32} />
            <p>{library.papers.length ? "Nothing matches that search." : "Your library is empty."}</p>
            {!library.papers.length && (
              <button class="primary" onClick={() => setPanel("add")}>
                <Icon name="plus" /> Add your first paper
              </button>
            )}
          </div>
        )}
      </main>

      {(error || busy) && (
        <div class="toasts">
          {busy && <div class="toast busy">{busy}…</div>}
          {error && (
            <div class="toast error" role="alert">
              <span>{error}</span>
              <button class="icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
                <Icon name="x" size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {paper && (
        <Detail
          key={paper.id}
          paper={paper}
          library={library.papers}
          storage={storage}
          result={result}
          lastAction={lastAction ?? undefined}
          onClose={() => setSelected(null)}
          onChange={(patch) => { library.update(paper.id, patch); scheduleSave(); }}
          onRemove={() => {
            if (!paper.trashed) {
              library.update(paper.id, { trashed: new Date().toISOString() });
              setSelected(null);
            } else if (confirm(`Delete "${paper.title}" for good? Its PDF stays in storage.`)) {
              library.remove(paper.id);
              setSelected(null);
            }
            scheduleSave();
          }}
          onAction={(id) => runAction(id, paper)}
          onRead={() => {
            library.update(paper.id, { opened: new Date().toISOString() });
            scheduleSave();
            setReadingPage(0);
            setReading(paper.id);
          }}
          onGetPdf={canFindOpenPdf(paper, pdfOptions(settings)) ? () => getPdf(paper) : undefined}
          onAdd={(d) => addDrafts([d]).length > 0}
          onError={setError}
          scheduleSave={scheduleSave}
          others={otherLibraries()}
          onCopyTo={(id) => copyTo(id, [paper])}
          offline={offlineStore && paper.pdf ? keptPdfs.has(paper.pdf) : undefined}
          onOffline={() => {
            if (!paper.pdf) return;
            if (keptPdfs.has(paper.pdf)) return void releaseOffline([paper.pdf]);
            keepOffline([paper]).then((m) => /space limit|could not/.test(m) && setError(m));
          }}
        />
      )}

      {reading && storage && library.papers.find((p) => p.id === reading)?.pdf && (
        <Reader
          paper={library.papers.find((p) => p.id === reading)!}
          storage={storage}
          page={readingPage}
          onClose={() => setReading(null)}
          onError={setError}
          onText={(id, text) => textIndex?.add(id, text).then(() => setTextVersion((v) => v + 1))}
        />
      )}

      {panel === "ask" && (
        <AskPanel
          papers={library.papers}
          texts={textIndex?.texts ?? new Map()}
          unindexed={textIndex?.missing(library.papers).length ?? 0}
          settings={settings}
          hidden={Boolean(reading)}
          onIndex={() => { if (!indexing) indexPdfs(); }}
          onOpen={openAt}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "map" && storage && (
        <CitationMap
          papers={library.papers}
          storage={storage}
          settings={settings}
          hidden={Boolean(reading)}
          onOpen={openAt}
          onAdd={(d) => addDrafts([d]).length > 0}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "fresh" && storage && (
        <FreshPanel
          papers={library.papers}
          storage={storage}
          settings={settings}
          hidden={Boolean(reading)}
          onOpen={openAt}
          onAdd={(d) => addDrafts([d]).length > 0}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "manuscript" && storage && (
        <ManuscriptPanel
          manuscripts={library.bibSync.filter((t) => t.tex !== undefined)}
          reports={manuscriptReports}
          papers={library.papers}
          hasToken={Boolean(syncToken())}
          defaultRepo=""
          checking={checking}
          hidden={Boolean(reading)}
          onSave={(manuscripts) => {
            library.bibSync = [...library.bibSync.filter((t) => t.tex === undefined), ...manuscripts];
            scheduleSave();
          }}
          onCheck={syncBibs}
          onSettings={() => setPanel("settings")}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "equation" && storage && (
        <EquationPanel papers={library.papers} storage={storage} hidden={Boolean(reading)} onOpen={openAt} onClose={() => setPanel(null)} />
      )}

      {panel === "writing" && (
        <WritingPanel papers={library.papers} texts={textIndex?.texts ?? new Map()} settings={settings} hidden={Boolean(reading)} onOpen={openAt} onClose={() => setPanel(null)} />
      )}

      {question && <QuestionDialog question={question} subject={paper?.title} />}
      {panel === "offline" && offlineStore && (
        <OfflinePanel
          papers={library.papers}
          inView={visible}
          view={view === "All papers" ? "your library" : `“${view}”`}
          storage={offlineStore}
          kept={keptPdfs}
          onKeep={keepOffline}
          onRelease={releaseOffline}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === "obsidian" && storage && (
        <ObsidianPanel papers={library.papers} inView={visible} storage={storage} onClose={() => setPanel(null)} />
      )}

      {panel === "add" && (
        <AddPanel
          initial={captured ?? undefined}
          files={sharedFiles}
          onAddPdf={addWithPdf}
          onClose={() => { setPanel(null); setCaptured(null); setSharedFiles([]); }}
          onAdd={(drafts) => {
            const added = addDrafts(drafts);
            if (added.length === 1) setSelected(added[0].id);
            return added.length;
          }}
          canAdd={Boolean(storage)}
        />
      )}
      {tidying && storage && (
        <TidyPanel
          papers={library.papers}
          version={version}
          onMerge={async (group) => {
            const keep = pickKeeper(group);
            const others = group.filter((p) => p !== keep);
            // Highlights belong to a paper id: bring them over when the keeper has none.
            if (!(await storage.read(annotationsPath(keep.id)).catch(() => null))) {
              for (const o of others) {
                const notes = await storage.read(annotationsPath(o.id)).catch(() => null);
                if (notes) {
                  await storage.write(annotationsPath(keep.id), new TextDecoder().decode(notes).replace(o.id, keep.id), "application/json");
                  break;
                }
              }
            }
            library.update(keep.id, mergeInto(keep, others));
            const now = new Date().toISOString();
            others.forEach((o) => library.update(o.id, { trashed: now }));
            scheduleSave();
          }}
          onUpdate={(items) => {
            items.forEach(({ paper: p, patch }) => library.update(p.id, patch));
            scheduleSave();
          }}
          onClose={() => setTidying(false)}
        />
      )}
      {syncing !== null && (
        <BibSyncPanel
          folder={syncing}
          count={papersInFolder(library.papers, syncing).length}
          targets={folderTargets(library.bibSync, syncing)}
          hasToken={Boolean(syncToken())}
          defaultRepo={providerId === "github" ? settings["storage.github.repo"] ?? "" : ""}
          onSave={(targets) => {
            library.bibSync = [...library.bibSync.filter((t) => !folderTargets([t], syncing).length), ...targets];
            scheduleSave();
            setSyncing(null);
          }}
          onClose={() => setSyncing(null)}
          onSettings={() => { setSyncing(null); setPanel("settings"); }}
        />
      )}
      {panel === "shared" && (
        <SharedPanel
          settings={settings}
          invite={invite}
          activeId={activeId(settings)}
          onName={(name) => updateSettings({ ...settings, "profile.name": name })}
          onSave={(next) => {
            setInvite(null);
            setSelected(null);
            updateSettings(next);
          }}
          onClose={() => { setInvite(null); setPanel(null); }}
        />
      )}
      {panel === "palette" && (
        <CommandPalette
          commands={commands}
          papers={library.papers}
          onOpenPaper={(id) => {
            setSelected(id);
            setResult(null);
          }}
          onClose={() => setPanel((p) => (p === "palette" ? null : p))}
        />
      )}
      {panel === "info" && <InfoPanel page={infoPage} onTour={() => { setPanel(null); setWelcome(true); }} onClose={() => setPanel(null)} />}
      {welcome && (
        <Welcome
          hasDemo={Boolean(demo) || demoPending}
          onOpenDemo={() => {
            closeWelcome();
            if (demo) {
              setSelected(demo.id);
              setResult(null);
            }
          }}
          onAdd={() => {
            closeWelcome();
            setPanel("add");
          }}
          onHelp={() => {
            closeWelcome();
            setInfoPage("start");
            setPanel("info");
          }}
          onClose={closeWelcome}
        />
      )}
      {panel === "settings" && <SettingsPanel settings={settings} onSave={updateSettings} onClose={() => setPanel(null)} />}
    </div>
  );
}

/** A heading for what the list shows. */
function viewTitle(query: string): string {
  const q = query.trim();
  const fixed: Record<string, string> = { "": "All papers", "is:starred": "Starred", "is:recent": "Recently read", "is:trash": "Trash" };
  if (q in fixed) return fixed[q];
  const folder = /^in:"([^"]+)"$/.exec(q);
  if (folder) return folder[1].split("/").join(" / ");
  const tag = /^tag:"([^"]+)"$/.exec(q);
  if (tag) return `#${tag[1]}`;
  return "Search results";
}

const THEME_KEY = "lightkone.theme";
type Theme = "" | "light" | "dark";
function applyTheme(t: Theme) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try {
  applyTheme((localStorage.getItem(THEME_KEY) as Theme) || "");
} catch {
  // follow the system
}

const THEME_EVENT = "lightkone-theme";
const currentTheme = () => (document.documentElement.dataset.theme as Theme) || "";
const nextTheme = (t: Theme): Theme => (t === "" ? "light" : t === "light" ? "dark" : "");
const THEME_NAMES = { "": "follow the system", light: "light", dark: "dark" } as const;

/** Choose the theme, remember it on this device, and tell the theme button. */
function chooseTheme(t: Theme) {
  applyTheme(t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // fine for this visit
  }
  dispatchEvent(new Event(THEME_EVENT));
}

/** Cycles between following the system, light and dark; remembered on this device. */
function ThemeButton(props: { class?: string }) {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const sync = () => setTheme(currentTheme());
    addEventListener(THEME_EVENT, sync);
    return () => removeEventListener(THEME_EVENT, sync);
  }, []);
  const next = nextTheme(theme);
  const label = { "": "Theme: follows your system", light: "Theme: light", dark: "Theme: dark" }[theme];
  const darkNow = theme === "dark" || (theme === "" && matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <button class={`icon-btn ${props.class ?? ""}`} title={`${label}. Click for ${next || "system"}.`} aria-label={label} onClick={() => chooseTheme(next)}>
      <Icon name={darkNow ? "moon" : "sun"} />
      {theme === "" && <span class="auto-dot" />}
    </button>
  );
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";

interface Tool {
  id: string;
  group: "Discover" | "Write" | "Organize";
  label: string;
  icon: IconName;
  hint: string;
  show?: boolean;
  run(): void;
}

const GROUPS_KEY = "lightkone.toolgroups.open";

/** The tools in the sidebar, under headings that fold; which are open is remembered on this device. */
function ToolGroups(props: { tools: Tool[] }) {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  function toggle(g: string) {
    const next = new Set(open);
    next.has(g) ? next.delete(g) : next.add(g);
    setOpen(next);
    try {
      localStorage.setItem(GROUPS_KEY, JSON.stringify([...next]));
    } catch {
      // fine for this visit
    }
  }
  const groups = [...new Set(props.tools.map((t) => t.group))];
  return (
    <div class="tool-groups">
      {groups.map((g) => {
        const items = props.tools.filter((t) => t.group === g);
        const on = open.has(g);
        return (
          <div key={g} class="tool-group">
            <button class="group-head" aria-expanded={on} onClick={() => toggle(g)} title={on ? undefined : items.map((t) => t.label).join(", ")}>
              <span class={`twisty ${on ? "open" : ""}`}>
                <Icon name="chevron" size={14} />
              </span>
              <span class="name">{g}</span>
              {!on && <span class="peek">{items.map((t) => t.label).join(" · ")}</span>}
            </button>
            {on && (
              <nav class="nav">
                {items.map((t) => (
                  <button key={t.id} class="tag" title={t.hint} onClick={t.run}>
                    <Icon name={t.icon} />
                    <span class="name">{t.label}</span>
                  </button>
                ))}
              </nav>
            )}
          </div>
        );
      })}
    </div>
  );
}

const OPEN_KEY = "lightkone.folders.open";

/** The folder tree in the sidebar; which folders are open is remembered on this device. */
function FolderList(props: { nodes: FolderNode[]; query: string; onPick(q: string): void }) {
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]"));
    } catch {
      return new Set();
    }
  });
  function toggle(path: string) {
    const next = new Set(open);
    next.has(path) ? next.delete(path) : next.add(path);
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]));
    } catch {
      // fine for this visit
    }
  }
  const render = (nodes: FolderNode[], depth: number) =>
    nodes.map((n) => {
      const q = `in:"${n.path}"`;
      return (
        <div key={n.path}>
          <div class="folder" style={{ paddingLeft: `${depth * 14}px` }}>
            {n.children.length ? (
              <button class={`ghost twisty ${open.has(n.path) ? "open" : ""}`} aria-label={open.has(n.path) ? "Close folder" : "Open folder"} aria-expanded={open.has(n.path)} onClick={() => toggle(n.path)}>
                <Icon name="chevron" size={14} />
              </button>
            ) : (
              <span class="twisty" />
            )}
            <button class={`tag ${props.query === q ? "on" : ""}`} onClick={() => props.onPick(props.query === q ? "" : q)}>
              <Icon name="folder" />
              <span class="name">{n.name}</span>
              <span class="count">{n.count}</span>
            </button>
          </div>
          {open.has(n.path) && render(n.children, depth + 1)}
        </div>
      );
    });
  return <>{render(props.nodes, 0)}</>;
}

function Detail(props: {
  paper: Paper;
  library: Paper[];
  storage: StorageAdapter | null;
  result: ActionResult | null;
  lastAction?: string;
  onClose(): void;
  onChange(patch: Partial<Paper>): void;
  onRemove(): void;
  onAction(id: string): void;
  onRead(): void;
  onGetPdf?(): void;
  onAdd(d: PaperDraft): boolean;
  onError(msg: string): void;
  scheduleSave(): void;
  /** Other libraries this paper can be copied to. */
  others: { id: string; name: string }[];
  onCopyTo(libraryId: string): void;
  /** Whether the PDF is kept on this device; undefined when that can't be chosen. */
  offline?: boolean;
  onOffline(): void;
}) {
  const { paper: p, storage } = props;
  const [tagText, setTagText] = useState(p.tags.join(", "));
  const [folderText, setFolderText] = useState("");
  const math = useMath();
  const known = allFolders(props.library);

  function addFolder() {
    const f = cleanFolder(folderText);
    if (f) props.onChange({ folders: [...new Set([...(p.folders ?? []), f])] });
    setFolderText("");
  }
  const [notes, setNotes] = useState(p.notes ?? "");
  const [addedTitles, setAddedTitles] = useState<Set<string>>(new Set());
  const [showAllAuthors, setShowAllAuthors] = useState(false);

  async function attachPdf(file: File) {
    if (!storage) return;
    try {
      // A replaced PDF keeps its place; a new one is filed the way Paperpile files it.
      const where = p.pdf ? { pdf: p.pdf, file: p.file } : pdfLocation(p, props.library);
      await storage.write(where.pdf, new Uint8Array(await file.arrayBuffer()), "application/pdf");
      props.onChange(where);
    } catch (e) {
      props.onError(`Could not store the PDF: ${(e as Error).message}`);
    }
  }
  async function openPdf() {
    if (!storage || !p.pdf) return;
    const tab = window.open("", "_blank");
    const bytes = await storage.read(p.pdf);
    if (!bytes) return props.onError("The PDF is missing from storage.");
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
    if (tab) tab.location.href = url;
  }

  const links: [string, string][] = [];
  if (p.arxiv) links.push(["arXiv", `https://arxiv.org/abs/${p.arxiv}`]);
  if (p.doi) links.push(["DOI", `https://doi.org/${p.doi}`]);
  if (p.url && !p.url.includes("arxiv.org") && !p.url.includes("doi.org")) links.push(["Link", p.url]);
  if (p.file) {
    const name = p.file.split("/").pop()!.replace(/\.pdf$/i, "");
    links.push(["Find PDF in Google Drive", `https://drive.google.com/drive/search?q=${encodeURIComponent(name)}`]);
  }
  const available = actions().filter((a) => !a.available || a.available(p));
  const actionIcon = (plugin: string): IconName | null => ({ claude: "sparkle", dullaby: "moon", related: "link" } as Record<string, IconName>)[plugin] ?? null;
  const [copied, setCopied] = useState<string | null>(null);
  function copy(what: string, text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <section class="detail" aria-label="Paper details">
      <div class="detail-bar">
        <button class="icon-btn" onClick={props.onClose} aria-label="Close" title="Close (Esc)">
          <Icon name="back" class="phone-only" />
          <Icon name="x" class="hide-phone" />
        </button>
        <span class="spacer" />
        <CiteMenu paper={p} />
        <button class="icon-btn" title="Copy BibTeX" aria-label="Copy BibTeX" onClick={() => copy("bibtex", paperToBibtex(p))}>
          <Icon name={copied === "bibtex" ? "check" : "copy"} />
        </button>
        <button class={`icon-btn star ${p.starred ? "on" : ""}`} aria-label={p.starred ? "Unstar" : "Star"} aria-pressed={Boolean(p.starred)} onClick={() => props.onChange({ starred: !p.starred || undefined })}>
          <Icon name="star" filled={Boolean(p.starred)} />
        </button>
      </div>
      <div class="detail-body">
        {p.trashed && (
          <p class="notice">
            In the trash. <button class="link" onClick={() => props.onChange({ trashed: undefined })}>Restore</button>
          </p>
        )}
        <p class="eyebrow">{[p.venue, p.year].filter(Boolean).join(" · ") || p.type}{p.by ? ` · added by ${p.by}` : ""}</p>
        <h2>{p.title}</h2>
        <p class="authors">
          {showAllAuthors || p.authors.length <= 12 ? p.authors.join("; ") : `${p.authors.slice(0, 10).join("; ")}; `}
          {!showAllAuthors && p.authors.length > 12 && (
            <button class="link" onClick={() => setShowAllAuthors(true)}>and {p.authors.length - 10} more</button>
          )}
        </p>
        <button class="cite-key" title="Copy citation key" onClick={() => copy("key", p.key)}>
          <span class="mono">{p.key}</span>
          <Icon name={copied === "key" ? "check" : "copy"} size={14} />
        </button>

        <div class="actions">
          {p.pdf && (
            <button class="primary" onClick={props.onRead}>
              <Icon name="book" /> Read
            </button>
          )}
          {!p.pdf && props.onGetPdf && (
            <button class="primary" onClick={props.onGetPdf}>
              <Icon name="download" /> Get free PDF
            </button>
          )}
          {props.others.length > 0 && (
            <select
              class="copy-to"
              value=""
              aria-label="Copy to another library"
              onChange={(e) => {
                const v = e.currentTarget.value;
                e.currentTarget.value = "";
                if (v !== "-") props.onCopyTo(v);
              }}
            >
              <option value="-">Copy to…</option>
              {props.others.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          {available.map((a) => {
            const icon = actionIcon(a.plugin);
            return (
              <button key={`${a.plugin}.${a.id}`} onClick={() => props.onAction(`${a.plugin}.${a.id}`)}>
                {icon && <Icon name={icon} />} {a.label}
              </button>
            );
          })}
        </div>

        <div class="links">
          {links.map(([label, href]) => (
            <a key={label} class="pill" href={href} target="_blank" rel="noopener">
              <Icon name="link" size={14} /> {label}
            </a>
          ))}
          {p.pdf && (
            <button class="pill" onClick={openPdf}>
              <Icon name="file" size={14} /> PDF file
            </button>
          )}
          {p.pdf && props.offline !== undefined && (
            <button class={`pill ${props.offline ? "on" : ""}`} aria-pressed={props.offline} onClick={props.onOffline} title={props.offline ? "Kept on this device; press to remove it from here" : "Keep this PDF on this device, to read with no network"}>
              <Icon name={props.offline ? "check" : "download"} size={14} /> {props.offline ? "Kept offline" : "Keep offline"}
            </button>
          )}
          <label class="pill file">
            <Icon name="upload" size={14} /> {p.pdf ? "Replace PDF" : "Attach PDF"}
            <input type="file" accept="application/pdf" onChange={(e) => e.currentTarget.files?.[0] && attachPdf(e.currentTarget.files[0])} />
          </label>
        </div>

        {props.result && props.result.kind === "text" && (
          <div class="result">
            <h3><Icon name="sparkle" size={14} /> {props.result.title}</h3>
            <div class="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(props.result.text, math) }} />
            {props.result.again && props.lastAction && (
              <button class="pill" onClick={() => props.onAction(props.lastAction!)}>
                <Icon name="sparkle" size={14} /> {props.result.again}
              </button>
            )}
          </div>
        )}
        {props.result && props.result.kind === "papers" && (
          <div class="result">
            <h3><Icon name="link" size={14} /> Related papers</h3>
            {!props.result.papers.length && <p class="muted">Nothing found for this one.</p>}
            <ul class="related">
              {props.result.papers.map((d) => (
                <li key={d.title}>
                  <div class="title">{d.title}</div>
                  <div class="meta">{shortAuthors(d)}{d.year ? ` · ${d.year}` : ""}</div>
                  <button
                    class="small"
                    disabled={addedTitles.has(d.title)}
                    onClick={() => {
                      props.onAdd(d);
                      setAddedTitles(new Set([...addedTitles, d.title]));
                    }}
                  >
                    {addedTitles.has(d.title) ? "In library" : "Add"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {p.abstract && (
          <section class="block">
            <h3>Abstract</h3>
            <div class="abstract" dangerouslySetInnerHTML={{ __html: renderMarkdown(p.abstract, math) }} />
          </section>
        )}

        <section class="block">
          <h3>Folders</h3>
          {(p.folders ?? []).length > 0 && (
            <div class="chips folders">
              {(p.folders ?? []).map((f) => (
                <span class="chip" key={f}>
                  <Icon name="folder" size={13} />
                  {f}
                  <button class="link" aria-label={`Take out of ${f}`} onClick={() => props.onChange({ folders: (p.folders ?? []).filter((x) => x !== f) })}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form class="add-folder" onSubmit={(e) => { e.preventDefault(); addFolder(); }}>
            <input list="known-folders" value={folderText} placeholder="Add to folder, e.g. Physics/QFT" onInput={(e) => setFolderText(e.currentTarget.value)} />
            <datalist id="known-folders">{known.map((f) => <option key={f} value={f} />)}</datalist>
            <button type="submit" disabled={!cleanFolder(folderText)}>Add</button>
          </form>
        </section>

        <section class="block">
          <h3>Tags</h3>
          <input
            value={tagText}
            placeholder="comma, separated, tags"
            onInput={(e) => setTagText(e.currentTarget.value)}
            onBlur={() => props.onChange({ tags: [...new Set(tagText.split(",").map((t) => t.trim()).filter(Boolean))] })}
          />
        </section>
        <section class="block">
          <h3>Notes</h3>
          <textarea rows={5} value={notes} placeholder="Your notes on this paper" onInput={(e) => setNotes(e.currentTarget.value)} onBlur={() => notes !== (p.notes ?? "") && props.onChange({ notes })} />
        </section>

        <p class="remove">
          <button class="link danger" onClick={props.onRemove}>
            <Icon name="trash" size={15} /> {p.trashed ? "Delete for good" : "Move to trash"}
          </button>
        </p>
      </div>
    </section>
  );
}

function TidyPanel(props: {
  papers: Paper[];
  version: number;
  onMerge(group: Paper[]): Promise<void>;
  onUpdate(items: Published[]): void;
  onClose(): void;
}) {
  const groups = useMemo(() => findDuplicates(props.papers), [props.version]);
  const preprints = props.papers.filter((p) => !p.trashed && p.arxiv && (!p.doi || /^10\.48550\//i.test(p.doi))).length;
  const [merging, setMerging] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [published, setPublished] = useState<Published[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(0);
  function update(items: Published[]) {
    props.onUpdate(items);
    setUpdated(updated + items.length);
    setPublished(published!.filter((x) => !items.includes(x)));
  }

  async function mergeAll(gs: Paper[][]) {
    setMerging(true);
    for (const g of gs) await props.onMerge(g);
    setMerging(false);
  }

  async function check() {
    setError(null);
    setProgress([0, preprints]);
    try {
      setPublished(await findPublished(props.papers, crossref, (d, n) => setProgress([d, n])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  const label = (p: Paper) => `${shortAuthors(p)}${p.year ? ` ${p.year}` : ""}${p.venue ? ` · ${p.venue}` : ""}${p.pdf ? " · PDF" : ""}`;

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel wide tidy-panel">
        <h2>Tidy up</h2>

        <h3>Duplicates</h3>
        {!groups.length ? (
          <p class="muted">No duplicates found.</p>
        ) : (
          <>
            <p class="muted small">
              The same paper entered more than once: same DOI, arXiv id or title. Merging keeps the copy with a PDF (or the oldest) and brings over the
              others' tags, folders, notes and missing details; the rest go to the trash.
            </p>
            <button class="primary" disabled={merging} onClick={() => mergeAll(groups)}>
              {merging ? "Merging…" : `Merge all ${groups.length}`}
            </button>
            <ul class="dupes">
              {groups.slice(0, 100).map((g) => {
                const keep = pickKeeper(g);
                return (
                  <li key={g.map((p) => p.id).join()}>
                    {g.map((p) => (
                      <div key={p.id} class={p === keep ? "keep" : ""}>
                        <span class="title">{p.title}</span>
                        <span class="meta"> {label(p)}{p === keep ? " · keep" : ""}</span>
                      </div>
                    ))}
                    <button class="small" disabled={merging} onClick={() => props.onMerge(g)}>Merge</button>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <h3>Published versions</h3>
        <p class="muted small">
          {preprints
            ? `${preprints} arXiv preprint${preprints > 1 ? "s" : ""} without a journal DOI. Lightkone can look up which have been published (arXiv and Semantic Scholar, then Crossref) and add the journal, DOI, volume and pages. Citation keys stay the same.`
            : published ? "" : "No arXiv preprints without a journal DOI."}
        </p>
        {preprints > 0 && !published && (
          <button class="primary" disabled={!!progress} onClick={check}>
            {progress ? `Checking ${progress[0]} of ${progress[1]}…` : `Check ${preprints} preprint${preprints > 1 ? "s" : ""}`}
          </button>
        )}
        {error && <p class="message">{error}</p>}
        {published && (
          <>
            {updated > 0 && <p class="message">Updated {updated} paper{updated > 1 ? "s" : ""} to the published version.</p>}
            {published.length > 0 && <p>{published.length} published:</p>}
            {!published.length && !updated && <p>None of them has a published version yet.</p>}
            {published.length > 0 && (
              <>
                <button class="primary" onClick={() => update(published)}>Update all {published.length}</button>
                <ul class="dupes">
                  {published.map((x) => (
                    <li key={x.paper.id}>
                      <div>
                        <span class="title">{x.paper.title}</span>
                        <span class="meta"> → {[x.patch.venue, x.patch.year, x.patch.doi].filter(Boolean).join(" · ")}</span>
                      </div>
                      <button class="small" onClick={() => update([x])}>Update</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        <div class="row">
          <button class="ghost" onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function BibSyncPanel(props: {
  folder: string;
  count: number;
  targets: BibTarget[];
  hasToken: boolean;
  defaultRepo: string;
  onSave(targets: BibTarget[]): void;
  onClose(): void;
  onSettings(): void;
}) {
  const t = props.targets[0];
  const [repo, setRepo] = useState(t?.repo ?? props.defaultRepo);
  const [path, setPath] = useState(t?.path ?? defaultBibPath(props.folder));
  const [branch, setBranch] = useState(t?.branch ?? "");
  const valid = /^[\w.-]+\/[\w.-]+$/.test(repo.trim()) && /\.bib$/i.test(path.trim());
  const name = props.folder || "your whole library";

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form
        class="panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) props.onSave([{ folder: props.folder, repo: repo.trim(), path: path.trim().replace(/^\/+/, ""), ...(branch.trim() ? { branch: branch.trim() } : {}) }]);
        }}
      >
        <h2>Sync .bib</h2>
        <p class="muted">
          Keep the {props.count} papers in <strong>{name}</strong> as a .bib file in a GitHub repository. It is rewritten whenever they change, so
          Overleaf (Menu → GitHub) or your paper's own repository always has current references. Citation keys never change.
        </p>
        {!props.hasToken && (
          <p class="message">
            First add a GitHub token under <button type="button" class="link" onClick={props.onSettings}>Settings → BibTeX sync to GitHub</button>.
          </p>
        )}
        <label class="field">
          <span>Repository</span>
          <input value={repo} placeholder="owner/name" onInput={(e) => setRepo(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>File</span>
          <input value={path} placeholder="references.bib" onInput={(e) => setPath(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Branch (optional)</span>
          <input value={branch} placeholder="main" onInput={(e) => setBranch(e.currentTarget.value)} />
        </label>
        <div class="row">
          <button class="primary" type="submit" disabled={!valid}>{t ? "Save and sync" : "Start syncing"}</button>
          {t && <button type="button" class="link danger" onClick={() => props.onSave([])}>Stop syncing</button>}
          <button type="button" class="ghost" onClick={props.onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function AddPanel(props: {
  initial?: string;
  files?: File[];
  onClose(): void;
  onAdd(d: PaperDraft[]): number;
  onAddPdf(d: PaperDraft, bytes: Uint8Array): Promise<"added" | "attached" | "had">;
  canAdd: boolean;
}) {
  const [text, setText] = useState(props.initial ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Something shared to Lightkone is looked up straight away.
  useEffect(() => {
    if (props.initial && props.canAdd) add(props.initial);
  }, [props.initial, props.canAdd]);
  // So are PDFs shared to the app or dropped on it.
  useEffect(() => {
    if (props.files?.length && props.canAdd) addPdfs(props.files);
  }, [props.files, props.canAdd]);

  /** Each PDF becomes a paper: found from the DOI or arXiv id it prints, else by Claude, else under its own title. */
  async function addPdfs(files: File[]) {
    setWorking(true);
    setMessage(null);
    const { pdfFirstPages } = await import("./reader/view");
    const counts = { added: 0, attached: 0, had: 0 };
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      if (files.length > 1) setMessage(`Reading ${i + 1} of ${files.length}: ${file.name}`);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { pages, title } = await pdfFirstPages(bytes);
        const id = identifierIn(pages);
        const finder = (s: string) => lookups().find((l) => l.matches(s));
        let draft: PaperDraft | null = null;
        if (id) draft = await finder(id)?.resolve(id).catch(() => null) ?? null;
        // Claude reads the first page when there is no identifier on it (with a key set).
        const firstPage = pages[0]?.slice(0, 3000).trim();
        if (!draft && firstPage && lookups().some((l) => l.id === "claude-find")) {
          draft = await lookups().find((l) => l.id === "claude-find")!.resolve(`The first page of a paper's PDF:\n${firstPage}`).catch(() => null);
        }
        draft ??= { type: "article", title: fallbackTitle(title, file.name), authors: [], fields: {} };
        counts[await props.onAddPdf(draft, bytes)]++;
      } catch (err) {
        failed.push(`${file.name} (${(err as Error).message})`);
      }
    }
    setMessage(
      [
        counts.added && `Added ${counts.added} paper${counts.added > 1 ? "s" : ""} with ${counts.added > 1 ? "their PDFs" : "its PDF"}.`,
        counts.attached && `Attached ${counts.attached} PDF${counts.attached > 1 ? "s" : ""} to papers already in your library.`,
        counts.had && `${counts.had} already in your library with a PDF, left unchanged.`,
        failed.length && `Couldn't read: ${failed.join(", ")}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
    setWorking(false);
  }

  function submit(e: Event) {
    e.preventDefault();
    add(text);
  }

  async function add(raw: string) {
    const input = raw.trim();
    if (!input) return;
    setWorking(true);
    setMessage(null);
    try {
      if (input.includes("@") && /@\w+\s*[{(]/.test(input)) {
        const drafts = importers().flatMap((i) => i.parse(input));
        const n = props.onAdd(drafts);
        setMessage(`Added ${n} of ${drafts.length} entries${drafts.length > n ? " (the rest were already in your library)" : ""}.`);
      } else {
        const lines = input.split(/\n+/).map((l) => l.trim()).filter(Boolean);
        let added = 0;
        const missed: string[] = [];
        for (const line of lines) {
          const lookup = lookups().find((l) => l.matches(line));
          const draft = lookup ? await lookup.resolve(line) : null;
          if (draft) added += props.onAdd([draft]);
          else missed.push(line);
        }
        setMessage(
          [added ? `Added ${added} paper${added > 1 ? "s" : ""}.` : "", missed.length ? `Couldn't find: ${missed.join(", ")}` : ""]
            .filter(Boolean)
            .join(" ") || "Already in your library.",
        );
      }
      setText("");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function onFile(file: File) {
    const text = await file.text();
    const drafts = importers().flatMap((i) => i.parse(text));
    const n = props.onAdd(drafts);
    setMessage(`Imported ${n} new papers from ${file.name} (${drafts.length} entries).`);
  }

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form class="panel" onSubmit={submit}>
        <h2>Add papers</h2>
        <p class="muted">
          Paste DOIs, arXiv ids or links (one per line), or BibTeX entries.
          {lookups().some((l) => l.id === "claude-find")
            ? " With a Claude key you can also paste any paper's page, or describe it: \"the 2017 transformer paper by Vaswani\"."
            : ""}
        </p>
        <textarea rows={6} value={text} autoFocus placeholder={"2106.09685\n10.1103/PhysRevLett.116.061102\n@article{...}"} onInput={(e) => setText(e.currentTarget.value)} />
        <div class="row">
          <button class="primary" type="submit" disabled={working || !props.canAdd}>{working ? "Looking up…" : "Add"}</button>
          <label class="button">
            Add PDF files
            <input type="file" accept="application/pdf,.pdf" multiple onChange={(e) => { const fs = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ""; fs.length && addPdfs(fs); }} />
          </label>
          <label class="button">
            Import a .bib file
            <input type="file" accept={importers().map((i) => i.accepts).join(",")} onChange={(e) => e.currentTarget.files?.[0] && onFile(e.currentTarget.files[0])} />
          </label>
          <button type="button" class="ghost" onClick={props.onClose}>Close</button>
        </div>
        {message && <p class="message">{message}</p>}
        <p class="muted small">
          On your phone, install Lightkone (browser menu → Install app), then share a paper's page or a PDF file to it. On a computer, drop PDF files anywhere on Lightkone, or drag this button to
          your bookmarks bar and click it on any paper's page:{" "}
          <a class="bookmarklet" href={bookmarklet(location.origin + location.pathname)} onClick={(e) => e.preventDefault()}>
            + Lightkone
          </a>
        </p>
      </form>
    </div>
  );
}

const CITE_KEY = "lightkone.cite.style";

/** Copy the paper as a formatted citation: a short line for a post, APA, Markdown, \cite or BibTeX. */
function CiteMenu(props: { paper: Paper }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<CiteStyle | null>(null);
  const last = (() => { try { return localStorage.getItem(CITE_KEY) as CiteStyle | null; } catch { return null; } })();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  function copy(style: CiteStyle) {
    navigator.clipboard?.writeText(cite(props.paper, style)).then(() => {
      try { localStorage.setItem(CITE_KEY, style); } catch { /* private window */ }
      setCopied(style);
      setTimeout(() => { setCopied(null); setOpen(false); }, 900);
    });
  }

  const styles = last ? [...CITE_STYLES].sort((a, b) => (b.id === last ? 1 : 0) - (a.id === last ? 1 : 0)) : CITE_STYLES;
  return (
    <div class="cite-menu" ref={ref}>
      <button class="small" aria-haspopup="menu" aria-expanded={open} title="Copy a formatted citation" onClick={() => setOpen(!open)}>
        <Icon name="copy" size={15} /> Cite
      </button>
      {open && (
        <div class="cite-pop" role="menu">
          {styles.map((s) => (
            <button key={s.id} role="menuitem" class="cite-option" onClick={() => copy(s.id)}>
              <span class="cite-label">{copied === s.id ? "Copied" : s.label}</span>
              <span class="cite-preview">{cite(props.paper, s.id)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A personal MCP address for the library in this person's own bucket or repository. */
function McpLink(props: { provider: string; config: Record<string, string> }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const linkable = props.provider === "s3" || props.provider === "github";
  const where = JSON.stringify(props);
  useEffect(() => { setUrl(""); setNote(""); }, [where]);

  async function make() {
    setBusy(true);
    setNote("");
    try {
      const r = await fetch(site("api/mcp-link"), { method: "POST", headers: { "Content-Type": "application/json" }, body: where });
      const body = await r.json().catch(() => ({ error: `The site answered ${r.status}.` }));
      if (!r.ok || !body.url) throw new Error(body.error ?? `The site answered ${r.status}.`);
      setUrl(body.url);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!linkable) {
    return (
      <p class="muted small">
        Claude on claude.ai, its apps and Claude Code can search and read your library, and add or tag papers, once the library is in an S3/R2
        bucket or a GitHub repository. A library kept only in this browser can't be reached from outside it.
      </p>
    );
  }
  return (
    <div>
      <p class="muted small">
        Claude on claude.ai, its apps and Claude Code can search and read your library, and add or tag papers. Make your own address, then add it
        in Claude under Settings → Connectors → Add custom connector. It uses the storage set above.
      </p>
      {url ? (
        <div class="mcp-link">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <div class="row">
            <button type="button" onClick={() => navigator.clipboard.writeText(url).then(() => setNote("Copied."))}>Copy address</button>
          </div>
          <p class="muted small">
            Treat it like a password: anyone with it can read and change your library. Your keys inside it are encrypted, and this site keeps no
            copy. To cut it off, replace the {props.provider === "github" ? "GitHub token" : "bucket's access key"} above.
          </p>
        </div>
      ) : (
        <div class="row">
          <button type="button" disabled={busy} onClick={make}>{busy ? "Checking your storage…" : "Make my AI app address"}</button>
        </div>
      )}
      {note && <p class="message">{note}</p>}
    </div>
  );
}

function SettingsPanel(props: { settings: Settings; onSave(s: Settings): void; onClose(): void }) {
  const [draft, setDraft] = useState<Settings>({ ...props.settings });
  const providerId = draft["storage.provider"] || "browser";
  const provider = storageProviders().find((p) => p.id === providerId) ?? storageProviders()[0];
  const set = (k: string, v: string) => setDraft({ ...draft, [k]: v });
  const [kept, setKept] = useState<boolean | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => void persistStorage().then(setKept), []);

  async function backup() {
    const day = new Date().toISOString().slice(0, 10);
    download(`lightkone-settings-${day}.json`, await exportSettings(draft, passphrase), "application/json");
    setNote(passphrase ? "Exported, encrypted with your passphrase." : "Exported. The file holds your keys in plain text: keep it somewhere private.");
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    try {
      setDraft(await importSettings(await file.text(), passphrase));
      setNote(`Read ${file.name}. Press Save to use these settings.`);
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form class="panel wide" onSubmit={(e) => { e.preventDefault(); props.onSave(draft); props.onClose(); }}>
        <h2>Settings</h2>
        <p class="muted small">
          Settings, keys and tokens are kept in this browser only
          {kept === true ? ", and the browser has agreed to keep them until you clear this site's data." : kept === false ? ". This browser may clear them if it runs low on space, so keep a backup." : "."}
        </p>

        <h3>Where your library lives</h3>
        <div class="providers">
          {storageProviders().map((p) => (
            <label key={p.id} class={`provider ${p.id === provider.id ? "on" : ""}`}>
              <input type="radio" name="provider" checked={p.id === provider.id} onChange={() => set("storage.provider", p.id)} />
              <strong>{p.label}</strong>
              <span class="muted small">{p.description}</span>
            </label>
          ))}
        </div>
        {provider.fields.map((f) => (
          <FieldInput key={f.name} field={f} value={draft[`storage.${provider.id}.${f.name}`] ?? ""} onInput={(v) => set(`storage.${provider.id}.${f.name}`, v)} />
        ))}

        {allPlugins()
          .filter((p) => p.settings?.length)
          .map((p) => (
            <div key={p.id}>
              <h3>{p.name}</h3>
              {p.description && <p class="muted small">{p.description}</p>}
              {p.settings!.map((f) => (
                <FieldInput key={f.name} field={f} value={draft[`${p.id}.${f.name}`] ?? ""} onInput={(v) => set(`${p.id}.${f.name}`, v)} />
              ))}
            </div>
          ))}

        <h3>Plugins</h3>
        <p class="muted small">
          Installed: {allPlugins().map((p) => p.name).join(", ")}. Add more by URL, one per line. A plugin is an ES module whose default export
          is a Lightkone plugin; it runs with full access to this page, so only add code you trust.
        </p>
        <textarea rows={2} value={draft["plugins.urls"] ?? ""} placeholder="https://example.com/my-plugin.js" onInput={(e) => set("plugins.urls", e.currentTarget.value)} />

        <h3>Claude and other AI apps (MCP)</h3>
        <McpLink provider={providerId} config={storageConfig(draft, providerId)} />

        <h3>Backup</h3>
        <p class="muted small">Save these settings to a file, or load them on another device. With a passphrase, the file is encrypted.</p>
        <label class="field">
          <span>Passphrase (optional)</span>
          <input type="password" autoComplete="new-password" value={passphrase} onInput={(e) => setPassphrase(e.currentTarget.value)} />
        </label>
        <div class="row">
          <button type="button" onClick={backup}>Export settings</button>
          <label class="button">
            Import settings
            <input type="file" accept=".json,application/json" hidden onChange={(e) => { restore(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
          </label>
        </div>
        {note && <p class="message">{note}</p>}

        <div class="row">
          <button class="primary" type="submit">Save</button>
          <button type="button" class="ghost" onClick={props.onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function FieldInput(props: { field: { name: string; label: string; type?: string; placeholder?: string; help?: string }; value: string; onInput(v: string): void }) {
  const f = props.field;
  return (
    <label class="field">
      <span>{f.label}</span>
      {f.type === "checkbox" ? (
        <input type="checkbox" class="check" checked={props.value !== "off"} onChange={(e) => props.onInput(e.currentTarget.checked ? "" : "off")} />
      ) : f.type === "textarea" ? (
        <textarea value={props.value} placeholder={f.placeholder} onInput={(e) => props.onInput(e.currentTarget.value)} />
      ) : (
        f.type === "password" ? (
          <input type="password" autoComplete="off" value={props.value} placeholder={f.placeholder} onInput={(e) => props.onInput(e.currentTarget.value)} />
        ) : (
          <input type="text" autoComplete="off" value={props.value} placeholder={f.placeholder} onInput={(e) => props.onInput(e.currentTarget.value)} />
        )
      )}
      {f.help && <span class="muted small">{f.help}</span>}
    </label>
  );
}
