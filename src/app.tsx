import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ActionResult, BibTarget, Paper, PaperDraft, StorageAdapter } from "./core/types";
import { Library } from "./core/library";
import { pdfLocation } from "./core/filing";
import { search, type SortBy } from "./core/search";
import { libraryToBibtex, paperToBibtex } from "./core/bibtex";
import { actions, allPlugins, importers, loadPluginFromUrl, lookups, storageProviders } from "./core/plugins";
import { exportSettings, importSettings, loadSettings, persistStorage, pluginUrls, saveSettings, storageConfig, type Settings } from "./core/settings";
import { matchPaperpilePdfs, PAPERPILE_DIR } from "./core/paperpile";
import { canFindOpenPdf, findOpenPdf, type OpenPdfOptions } from "./core/openpdf";
import { Reader } from "./reader/Reader";
import { browserCache, withOfflineCache, type OfflineStorage } from "./core/offline";
import { bookmarklet, CAPTURE_KEYS, capturedInput } from "./core/capture";
import { allFolders, cleanFolder, folderTree, type FolderNode } from "./core/folders";
import { renderMarkdown } from "./core/markdown";
import { useMath } from "./core/math";
import { defaultBibPath, papersInFolder, runBibSync } from "./core/bibsync";
import { githubStorage } from "./plugins/storage-github";
import { crossref } from "./plugins/lookup";
import { findDuplicates, findPublished, mergeInto, pickKeeper, type Published } from "./core/tidy";
import { annotationsPath } from "./core/annotations";
import { Icon, type IconName } from "./icons";

const library = new Library();

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

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
  const keys = await storage.list(PAPERPILE_DIR).catch(() => [] as string[]);
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
  const [panel, setPanel] = useState<"add" | "settings" | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  // A paper shared to Lightkone, or sent by the bookmarklet, waiting for storage to open.
  const [captured, setCaptured] = useState<string | null>(() => capturedInput(location.search));

  // Open storage whenever the chosen provider or its settings change.
  const providerId = settings["storage.provider"] || "browser";
  const storageKey = JSON.stringify(storageConfig(settings, providerId)) + providerId;
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
      const provider = storageProviders().find((p) => p.id === providerId) ?? storageProviders()[0];
      try {
        const remote = provider.create(storageConfig(settings, provider.id));
        // This browser's own storage is already offline; others keep an offline copy.
        const adapter = provider.id === "browser" ? remote : withOfflineCache(remote, browserCache());
        library.storage = adapter;
        setStatus(`Opening your library from ${provider.label}…`);
        const { loaded, seeded, foldered } = await library.load();
        if (cancelled) return;
        setStorage(adapter);
        setWhere(provider.label);
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
        if (seeded || linked || foldered) {
          scheduleSave();
        } else if (!loaded && !library.papers.length && !captured) {
          setPanel("add");
        }
      } catch (e) {
        if (cancelled) return;
        library.storage = null;
        library.papers = [];
        setStorage(null);
        setWhere(null);
        setStatus("Not connected");
        setError(`Could not open ${provider.label}: ${(e as Error).message}`);
        setPanel("settings");
      }
      setVersion((v) => v + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey, settings["plugins.urls"]]);

  useEffect(() => library.onChange(() => setVersion((v) => v + 1)), []);

  // Once storage is open, hand a captured paper to the Add panel and tidy the address bar.
  useEffect(() => {
    if (!captured || !storage) return;
    setPanel("add");
    const url = new URL(location.href);
    CAPTURE_KEYS.forEach((k) => url.searchParams.delete(k));
    history.replaceState(null, "", url);
  }, [captured, storage]);

  function scheduleSave() {
    setSaveState("pending");
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        await library.save();
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
        setError(`Could not save: ${(e as Error).message}`);
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
    const r = await runBibSync(library.bibSync, library.papers, (t) => githubStorage({ repo: t.repo, branch: t.branch, token, api }));
    if (r.errors.length) setError(`BibTeX sync failed for ${r.errors.join("; ")}`);
    if (r.written.length) setBibNote(` · .bib synced to ${r.written.join(", ")}`);
  }

  // Warn before closing with unsaved changes.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState === "pending" || saveState === "saving") e.preventDefault();
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [saveState]);

  const visible = useMemo(() => search(library.papers, query, sort), [version, query, sort]);
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
      if (panel || tidying || syncing !== null || reading || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
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
  }, [visible, selected, panel, tidying, syncing, reading]);

  function updateSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
    persistStorage();
  }

  function addDrafts(drafts: PaperDraft[]): Paper[] {
    const { added, updated } = library.merge(drafts);
    if (added.length || updated.length) scheduleSave();
    // Fetch free PDFs in the background; a big .bib import is left alone.
    if (settings["pdfs.auto"] !== "off" && added.length <= 20) added.forEach((p) => getPdf(p, true));
    return added;
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
    setBusy(action.label);
    setError(null);
    try {
      const r = await action.run(p, {
        settings,
        storage,
        library: library.papers,
        open: (url) => window.open(url, "_blank", "noopener"),
        ask: (q, placeholder) => window.prompt(q, placeholder ?? ""),
      });
      if (r.kind !== "none") setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const saveLabel = { idle: "", pending: "Unsaved", saving: "Saving…", saved: "Saved", error: "Not saved" }[saveState];
  const view = viewTitle(query);

  return (
    <div class={`app ${paper ? "has-detail" : ""}`}>
      <header class="top">
        <button class="icon-btn browse" onClick={() => setSideOpen(!sideOpen)} aria-expanded={sideOpen} aria-label="Folders and tags">
          <Icon name="menu" />
        </button>
        <div class="brand">
          <img class="logo" src="./icon.svg" alt="" />
          <span>Lightkone</span>
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
            <span class={`save ${saveState}`} role="status">
              {saveState === "saved" && <Icon name="check" size={14} />}
              {saveLabel}
            </span>
          )}
          <button class="primary add" onClick={() => setPanel("add")} disabled={!storage}>
            <Icon name="plus" />
            <span class="label">Add paper</span>
          </button>
          <button class="icon-btn hide-phone" onClick={() => download("library.bib", libraryToBibtex(visible))} disabled={!visible.length} title="Export the papers in view as BibTeX" aria-label="Export .bib">
            <Icon name="download" />
          </button>
          <ThemeButton />
          <button class="icon-btn" onClick={() => setPanel("settings")} title="Settings" aria-label="Settings">
            <Icon name="settings" />
          </button>
        </div>
      </header>

      {sideOpen && <div class="side-backdrop" onClick={() => setSideOpen(false)} />}
      <aside class={`side ${sideOpen ? "open" : ""}`}>
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
          {storage && (
            <button class="tag" title="Duplicates, published versions of preprints" onClick={() => { setTidying(true); setSideOpen(false); }}>
              <Icon name="broom" />
              <span class="name">Tidy up</span>
            </button>
          )}
        </nav>
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
          <Icon name="cloud" size={15} />
          <span>{where ? `${where}${seededNote}${bibNote}` : status}</span>
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
                {library.bibSync.some((t) => t.folder === (query ? query.slice(4, -1) : "")) ? "Syncing .bib" : "Sync .bib"}
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
              {(p.pdf || p.tags.length > 0) && (
                <div class="chips">
                  {p.pdf && <span class="chip pdf">PDF</span>}
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
            setReading(paper.id);
          }}
          onGetPdf={canFindOpenPdf(paper, pdfOptions(settings)) ? () => getPdf(paper) : undefined}
          onAdd={(d) => addDrafts([d]).length > 0}
          onError={setError}
          scheduleSave={scheduleSave}
        />
      )}

      {reading && storage && library.papers.find((p) => p.id === reading)?.pdf && (
        <Reader paper={library.papers.find((p) => p.id === reading)!} storage={storage} onClose={() => setReading(null)} onError={setError} />
      )}

      {panel === "add" && (
        <AddPanel
          initial={captured ?? undefined}
          onClose={() => { setPanel(null); setCaptured(null); }}
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
          targets={library.bibSync.filter((t) => t.folder === syncing)}
          hasToken={Boolean(syncToken())}
          defaultRepo={providerId === "github" ? settings["storage.github.repo"] ?? "" : ""}
          onSave={(targets) => {
            library.bibSync = [...library.bibSync.filter((t) => t.folder !== syncing), ...targets];
            scheduleSave();
            setSyncing(null);
          }}
          onClose={() => setSyncing(null)}
          onSettings={() => { setSyncing(null); setPanel("settings"); }}
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

/** Cycles between following the system, light and dark; remembered on this device. */
function ThemeButton() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme as Theme) || "");
  const next: Theme = theme === "" ? "light" : theme === "light" ? "dark" : "";
  const label = { "": "Theme: follows your system", light: "Theme: light", dark: "Theme: dark" }[theme];
  const darkNow = theme === "dark" || (theme === "" && matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <button
      class="icon-btn"
      title={`${label}. Click for ${next || "system"}.`}
      aria-label={label}
      onClick={() => {
        setTheme(next);
        applyTheme(next);
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch {
          // fine for this visit
        }
      }}
    >
      <Icon name={darkNow ? "moon" : "sun"} />
      {theme === "" && <span class="auto-dot" />}
    </button>
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
  onClose(): void;
  onChange(patch: Partial<Paper>): void;
  onRemove(): void;
  onAction(id: string): void;
  onRead(): void;
  onGetPdf?(): void;
  onAdd(d: PaperDraft): boolean;
  onError(msg: string): void;
  scheduleSave(): void;
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
        <p class="eyebrow">{[p.venue, p.year].filter(Boolean).join(" · ") || p.type}</p>
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
          <label class="pill file">
            <Icon name="upload" size={14} /> {p.pdf ? "Replace PDF" : "Attach PDF"}
            <input type="file" accept="application/pdf" onChange={(e) => e.currentTarget.files?.[0] && attachPdf(e.currentTarget.files[0])} />
          </label>
        </div>

        {props.result && props.result.kind === "text" && (
          <div class="result">
            <h3><Icon name="sparkle" size={14} /> {props.result.title}</h3>
            <div class="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(props.result.text, math) }} />
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

function AddPanel(props: { initial?: string; onClose(): void; onAdd(d: PaperDraft[]): number; canAdd: boolean }) {
  const [text, setText] = useState(props.initial ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  // Something shared to Lightkone is looked up straight away.
  useEffect(() => {
    if (props.initial && props.canAdd) add(props.initial);
  }, [props.initial, props.canAdd]);

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
            Import a .bib file
            <input type="file" accept={importers().map((i) => i.accepts).join(",")} onChange={(e) => e.currentTarget.files?.[0] && onFile(e.currentTarget.files[0])} />
          </label>
          <button type="button" class="ghost" onClick={props.onClose}>Close</button>
        </div>
        {message && <p class="message">{message}</p>}
        <p class="muted small">
          On your phone, install Lightkone (browser menu → Install app) and share a paper's page to it. On a computer, drag this button to
          your bookmarks bar and click it on any paper's page:{" "}
          <a class="bookmarklet" href={bookmarklet(location.origin + location.pathname)} onClick={(e) => e.preventDefault()}>
            + Lightkone
          </a>
        </p>
      </form>
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
      const r = await fetch("api/mcp-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: where });
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
