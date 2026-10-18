import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ActionResult, Paper, PaperDraft, StorageAdapter } from "./core/types";
import { Library, pdfPath } from "./core/library";
import { search, type SortBy } from "./core/search";
import { libraryToBibtex, paperToBibtex } from "./core/bibtex";
import { actions, allPlugins, importers, loadPluginFromUrl, lookups, storageProviders } from "./core/plugins";
import { loadSettings, pluginUrls, saveSettings, storageConfig, type Settings } from "./core/settings";

const library = new Library();

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

function download(name: string, text: string, type = "application/x-bibtex") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortBy>("added");
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<"add" | "settings" | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

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
        const adapter = provider.create(storageConfig(settings, provider.id));
        library.storage = adapter;
        setStatus(`Opening your library from ${provider.label}…`);
        const { loaded, seeded } = await library.load();
        if (cancelled) return;
        setStorage(adapter);
        setWhere(provider.label);
        setSeededNote(seeded ? ` · ${seeded} new from .bib files` : "");
        if (seeded) {
          scheduleSave();
        } else if (!loaded && !library.papers.length) {
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
      }
    }, 1200);
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
  const [tagFilter, setTagFilter] = useState("");
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

  function updateSettings(next: Settings) {
    setSettings(next);
    saveSettings(next);
  }

  function addDrafts(drafts: PaperDraft[]): Paper[] {
    const { added, updated } = library.merge(drafts);
    if (added.length || updated.length) scheduleSave();
    return added;
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

  const saveLabel = { idle: "", pending: "Unsaved changes", saving: "Saving…", saved: "Saved", error: "Not saved" }[saveState];

  return (
    <div class={`app ${paper ? "has-detail" : ""}`}>
      <header class="top">
        <div class="brand">
          <img class="logo" src="./icon.svg" alt="" />
          <span>Lightkone</span>
        </div>
        <input
          class="search"
          type="search"
          placeholder='Search titles, authors, abstracts… or tag:"…" author:… year:2019-2021'
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div class="top-actions">
          <button class="primary" onClick={() => setPanel("add")} disabled={!storage}>
            Add paper
          </button>
          <button onClick={() => download("library.bib", libraryToBibtex(visible))} disabled={!visible.length} title="Export the papers in view as BibTeX">
            Export .bib
          </button>
          <button class="ghost" onClick={() => setPanel("settings")}>
            Settings
          </button>
        </div>
      </header>

      <div class="statusbar">
        <span>{where ? `${library.papers.length} papers · ${where}${seededNote}` : status}</span>
        {saveLabel && <span class={`save ${saveState}`}>{saveLabel}</span>}
        {busy && <span class="busy">{busy}…</span>}
      </div>
      {error && (
        <div class="error" role="alert">
          {error} <button class="link" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <aside class="side">
        <button class={`tag ${!query ? "on" : ""}`} onClick={() => setQuery("")}>
          All papers <span>{library.papers.length}</span>
        </button>
        <h3>Tags</h3>
        {tags.length === 0 && <p class="muted small">Tags from your papers show here.</p>}
        {tags.length > 30 && (
          <input class="tag-filter" placeholder={`Filter ${tags.length} tags`} value={tagFilter} onInput={(e) => setTagFilter(e.currentTarget.value)} />
        )}
        {shownTags.map(([t, n]) => {
          const q = `tag:"${t}"`;
          return (
            <button key={t} class={`tag ${query === q ? "on" : ""}`} onClick={() => setQuery(query === q ? "" : q)}>
              {t} <span>{n}</span>
            </button>
          );
        })}
        {shownTags.length < matchingTags.length && (
          <button class="link small more" onClick={() => setAllTags(true)}>
            Show all {matchingTags.length} tags
          </button>
        )}
      </aside>

      <main class="list">
        <div class="list-head">
          <span>
            {visible.length} {visible.length === 1 ? "paper" : "papers"}
          </span>
          <label>
            Sort{" "}
            <select value={sort} onChange={(e) => setSort(e.currentTarget.value as SortBy)}>
              <option value="added">Recently added</option>
              <option value="year">Year</option>
              <option value="title">Title</option>
              <option value="relevance">Relevance</option>
            </select>
          </label>
        </div>
        <ul>
          {visible.slice(0, 500).map((p) => (
            <li key={p.id} class={p.id === selected ? "on" : ""} onClick={() => { setSelected(p.id); setResult(null); }}>
              <div class="title">{p.title}</div>
              <div class="meta">
                {shortAuthors(p)}
                {p.year ? ` · ${p.year}` : ""}
                {p.venue ? ` · ${p.venue}` : ""}
              </div>
              {p.tags.length > 0 && (
                <div class="chips">
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
          <p class="muted center">{library.papers.length ? "Nothing matches that search." : "Your library is empty. Add a paper to start."}</p>
        )}
      </main>

      {paper && (
        <Detail
          key={paper.id}
          paper={paper}
          storage={storage}
          result={result}
          onClose={() => setSelected(null)}
          onChange={(patch) => { library.update(paper.id, patch); scheduleSave(); }}
          onRemove={() => {
            if (!confirm(`Remove "${paper.title}" from the library?`)) return;
            library.remove(paper.id);
            setSelected(null);
            scheduleSave();
          }}
          onAction={(id) => runAction(id, paper)}
          onAdd={(d) => addDrafts([d]).length > 0}
          onError={setError}
          scheduleSave={scheduleSave}
        />
      )}

      {panel === "add" && (
        <AddPanel
          onClose={() => setPanel(null)}
          onAdd={(drafts) => {
            const added = addDrafts(drafts);
            if (added.length === 1) setSelected(added[0].id);
            return added.length;
          }}
          canAdd={Boolean(storage)}
        />
      )}
      {panel === "settings" && <SettingsPanel settings={settings} onSave={updateSettings} onClose={() => setPanel(null)} />}
    </div>
  );
}

function Detail(props: {
  paper: Paper;
  storage: StorageAdapter | null;
  result: ActionResult | null;
  onClose(): void;
  onChange(patch: Partial<Paper>): void;
  onRemove(): void;
  onAction(id: string): void;
  onAdd(d: PaperDraft): boolean;
  onError(msg: string): void;
  scheduleSave(): void;
}) {
  const { paper: p, storage } = props;
  const [tagText, setTagText] = useState(p.tags.join(", "));
  const [notes, setNotes] = useState(p.notes ?? "");
  const [addedTitles, setAddedTitles] = useState<Set<string>>(new Set());
  const [showAllAuthors, setShowAllAuthors] = useState(false);

  async function attachPdf(file: File) {
    if (!storage) return;
    try {
      const path = pdfPath(p.id);
      await storage.write(path, new Uint8Array(await file.arrayBuffer()), "application/pdf");
      props.onChange({ pdf: path });
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

  return (
    <section class="detail" aria-label="Paper details">
      <button class="close ghost" onClick={props.onClose} aria-label="Close">×</button>
      <h2>{p.title}</h2>
      <p class="authors">
        {showAllAuthors || p.authors.length <= 12 ? p.authors.join("; ") : `${p.authors.slice(0, 10).join("; ")}; `}
        {!showAllAuthors && p.authors.length > 12 && (
          <button class="link" onClick={() => setShowAllAuthors(true)}>and {p.authors.length - 10} more</button>
        )}
      </p>
      <p class="muted">
        {[p.venue, p.year].filter(Boolean).join(" · ")}
        {" · "}
        <button class="link mono" title="Copy citation key" onClick={() => navigator.clipboard?.writeText(p.key)}>
          {p.key}
        </button>
      </p>

      <div class="links">
        {links.map(([label, href]) => (
          <a key={label} href={href} target="_blank" rel="noopener">{label}</a>
        ))}
        {p.pdf && <button class="link" onClick={openPdf}>Open PDF</button>}
        <label class="link file">
          {p.pdf ? "Replace PDF" : "Attach PDF"}
          <input type="file" accept="application/pdf" onChange={(e) => e.currentTarget.files?.[0] && attachPdf(e.currentTarget.files[0])} />
        </label>
      </div>

      <div class="actions">
        {available.map((a) => (
          <button key={`${a.plugin}.${a.id}`} onClick={() => props.onAction(`${a.plugin}.${a.id}`)}>{a.label}</button>
        ))}
        <button onClick={() => navigator.clipboard?.writeText(paperToBibtex(p))}>Copy BibTeX</button>
      </div>

      {props.result && props.result.kind === "text" && (
        <div class="result">
          <h3>{props.result.title}</h3>
          <div class="prose">{props.result.text}</div>
        </div>
      )}
      {props.result && props.result.kind === "papers" && (
        <div class="result">
          <h3>Related papers</h3>
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
        <>
          <h3>Abstract</h3>
          <p class="abstract">{p.abstract}</p>
        </>
      )}

      <h3>Tags</h3>
      <input
        value={tagText}
        placeholder="comma, separated, tags"
        onInput={(e) => setTagText(e.currentTarget.value)}
        onBlur={() => props.onChange({ tags: [...new Set(tagText.split(",").map((t) => t.trim()).filter(Boolean))] })}
      />
      <h3>Notes</h3>
      <textarea rows={5} value={notes} onInput={(e) => setNotes(e.currentTarget.value)} onBlur={() => notes !== (p.notes ?? "") && props.onChange({ notes })} />

      <p class="remove">
        <button class="link danger" onClick={props.onRemove}>Remove from library</button>
      </p>
    </section>
  );
}

function AddPanel(props: { onClose(): void; onAdd(d: PaperDraft[]): number; canAdd: boolean }) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    const input = text.trim();
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
        <p class="muted">Paste DOIs, arXiv ids or links (one per line), or BibTeX entries.</p>
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
      </form>
    </div>
  );
}

function SettingsPanel(props: { settings: Settings; onSave(s: Settings): void; onClose(): void }) {
  const [draft, setDraft] = useState<Settings>({ ...props.settings });
  const providerId = draft["storage.provider"] || "browser";
  const provider = storageProviders().find((p) => p.id === providerId) ?? storageProviders()[0];
  const set = (k: string, v: string) => setDraft({ ...draft, [k]: v });

  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <form class="panel wide" onSubmit={(e) => { e.preventDefault(); props.onSave(draft); props.onClose(); }}>
        <h2>Settings</h2>
        <p class="muted small">Settings, keys and tokens are kept in this browser only.</p>

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
      {f.type === "textarea" ? (
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
