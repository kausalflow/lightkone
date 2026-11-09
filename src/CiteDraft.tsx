import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper, PaperDraft } from "./core/types";
import { applyCites, parseTriage, queryFor, sentencesOf, triagePrompt, uncitedClaims, type Sentence, type Triage } from "./core/citedraft";
import { candidatesFor, citeKeysIn, papersForKeys, parseVerdicts, type Verdict } from "./core/writing";
import { inLibrary, searchLiterature, type Outside } from "./core/literature";
import { sourcesPrompt, type Source } from "./core/ask";
import { shortAuthors } from "./core/cite";
import { libraryToBibtex } from "./core/bibtex";
import { checkSupport, triageDraft } from "./plugins/claude";

const COMMANDS = ["cite", "citep", "citet", "autocite", "parencite"];
const RANK: Record<Verdict["support"], number> = { supports: 0, related: 1, no: 2 };
const STORE = "lightkone.citedraft";
/** Sentences sent to Claude in one triage request. */
const TRIAGE_BATCH = 80;

interface Suggestion {
  /** The library's paper, or the found paper shaped like one. */
  paper: Paper;
  /** Set when the paper is not in the library yet. */
  outside?: Outside;
  passage: Source;
  verdict?: Verdict;
}

interface Found {
  items: Suggestion[];
  picked: Set<string>;
  checked: boolean;
  note?: string;
}

interface Saved {
  tex: string;
  name: string;
  chosen: [number, string[]][];
  triage: Triage[];
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // A private window, or a draft too big to keep; it still works until the panel closes.
  }
}

function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Find the claims in a LaTeX draft that cite nothing, suggest papers for each, and put the \cite in. */
export function CiteDraft(props: {
  papers: Paper[];
  texts: Map<string, string>;
  settings: Record<string, string>;
  onOpen(paperId: string, page: number): void;
  onAdd(d: PaperDraft): Paper | undefined;
}) {
  const saved = useMemo(load, []);
  const [tex, setTex] = useState(saved?.tex ?? "");
  const [name, setName] = useState(saved?.name ?? "");
  const [editing, setEditing] = useState(!saved?.tex);
  const [chosen, setChosen] = useState<Map<number, string[]>>(() => new Map(saved?.chosen ?? []));
  const [triage, setTriage] = useState<Map<number, Triage> | null>(() => (saved?.triage?.length ? new Map(saved.triage.map((t) => [t.n, t])) : null));
  const [showAll, setShowAll] = useState(false);
  const [found, setFound] = useState<Map<number, Found>>(new Map());
  const [working, setWorking] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cmd, setCmd] = useState(() => {
    try {
      return localStorage.getItem("lightkone.cite.command") || "cite";
    } catch {
      return "cite";
    }
  });
  const abort = useRef<AbortController | null>(null);
  const hasKey = Boolean(props.settings["claude.apiKey"]);

  const sentences = useMemo(() => (editing ? [] : sentencesOf(tex)), [tex, editing]);
  const uncited = useMemo(() => sentences.filter((s) => !s.cited), [sentences]);
  const claims = useMemo(() => uncitedClaims(sentences), [sentences]);
  const shown = useMemo(() => {
    if (showAll) return uncited;
    if (triage) return uncited.filter((s) => triage.get(s.n)?.needs || chosen.has(s.n));
    return uncited.filter((s) => s.score >= 1 || chosen.has(s.n));
  }, [showAll, triage, uncited, chosen]);
  const out = useMemo(() => applyCites(tex, sentences, chosen, cmd), [tex, sentences, chosen, cmd]);
  const added = [...chosen.values()].filter((k) => k.length).length;

  useEffect(() => save({ tex, name, chosen: [...chosen], triage: triage ? [...triage.values()] : [] }), [tex, name, chosen, triage]);
  useEffect(() => () => abort.current?.abort(), []);

  function read(e?: Event) {
    e?.preventDefault();
    if (!tex.trim()) return;
    setEditing(false);
    setChosen(new Map());
    setTriage(null);
    setFound(new Map());
    setShowAll(false);
    setNote(null);
  }

  async function open(file: File | undefined) {
    if (!file) return;
    setTex(await file.text());
    setName(file.name);
    setEditing(true);
  }

  function pickCmd(c: string) {
    setCmd(c);
    try {
      localStorage.setItem("lightkone.cite.command", c);
    } catch {
      // private window
    }
  }

  function stop() {
    abort.current?.abort();
    abort.current = null;
  }

  /** Ask Claude which uncited sentences need a citation, in batches. */
  async function askClaude() {
    stop();
    const ctl = (abort.current = new AbortController());
    setNote(null);
    const next = new Map<number, Triage>();
    try {
      for (let i = 0; i < uncited.length; i += TRIAGE_BATCH) {
        setBusy(`Claude is reading sentences ${i + 1}–${Math.min(uncited.length, i + TRIAGE_BATCH)} of ${uncited.length}`);
        const batch = uncited.slice(i, i + TRIAGE_BATCH);
        const reply = parseTriage(await triageDraft(props.settings, triagePrompt(sentences, batch), ctl.signal));
        const asked = new Set(batch.map((s) => s.n));
        for (const t of reply) if (asked.has(t.n)) next.set(t.n, t);
        // A sentence Claude passed over is kept as it was by the word cues.
        for (const s of batch) if (!next.has(s.n)) next.set(s.n, { n: s.n, needs: s.score >= 1 });
      }
      setTriage(next);
      setShowAll(false);
      const needs = [...next.values()].filter((t) => t.needs).length;
      setNote(`Claude marks ${needs} of ${uncited.length} uncited sentence${uncited.length === 1 ? "" : "s"} as needing a citation.`);
    } catch (e) {
      if (!ctl.signal.aborted) setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Papers for one sentence: the library's first, then OpenAlex's, checked by Claude when there is a key. */
  async function suggest(s: Sentence, signal?: AbortSignal) {
    setWorking((w) => new Set(w).add(s.n));
    const query = triage?.get(s.n)?.query;
    try {
      const sources: Source[] = [];
      const items: Suggestion[] = [];
      for (const c of candidatesFor(props.papers, props.texts, query ? `${s.plain} ${query}` : s.plain, 5)) {
        for (const p of c.passages.slice(0, 2)) {
          const src = { ...p, n: sources.length + 1 };
          sources.push(src);
          if (!items.some((x) => x.paper.id === c.paper.id)) items.push({ paper: c.paper, passage: src });
        }
      }
      let outsideNote: string | undefined;
      try {
        const works = await searchLiterature(query || queryFor(s.plain), { key: props.settings["related.openalexKey"] || undefined, signal, limit: 8 });
        for (const w of works) {
          const own = inLibrary(w.draft, props.papers);
          if (own && items.some((x) => x.paper.id === own.id)) continue;
          if (items.filter((x) => x.outside).length >= 5) break;
          const src: Source = { n: sources.length + 1, paperId: own?.id ?? w.id, page: 0, text: w.abstract ?? w.title };
          sources.push(src);
          items.push(own ? { paper: own, passage: src } : { paper: w, outside: w, passage: src });
        }
      } catch (e) {
        if (signal?.aborted) throw e;
        outsideNote = (e as Error).message;
      }
      let checked = false;
      if (hasKey && items.length) {
        const byId = new Map<string, Paper>(items.map((x) => [x.paper.id, x.paper]));
        const vs = parseVerdicts(await checkSupport(props.settings, s.plain, sourcesPrompt(sources, byId), signal));
        for (const v of vs) {
          const src = sources.find((x) => x.n === v.n);
          const item = src && items.find((x) => x.paper.id === src.paperId);
          if (!item) continue;
          if (!item.verdict || RANK[v.support] < RANK[item.verdict.support]) {
            item.verdict = v;
            item.passage = src;
          }
        }
        checked = vs.length > 0;
        // Library papers first among equals, as the plan says.
        items.sort((a, b) => RANK[a.verdict?.support ?? "no"] - RANK[b.verdict?.support ?? "no"] || Number(Boolean(a.outside)) - Number(Boolean(b.outside)));
      }
      const picked = new Set(items.filter((x) => x.verdict?.support === "supports").map((x) => x.paper.id));
      const empty = items.length ? undefined : "Nothing found in your library or on OpenAlex. Try Show every uncited sentence, or Cite this with your own words.";
      setFound((f) => new Map(f).set(s.n, { items, picked, checked, note: outsideNote ?? empty ?? (hasKey && !checked ? "Claude's reply could not be read; tick papers yourself." : undefined) }));
    } catch (e) {
      if (!signal?.aborted) setFound((f) => new Map(f).set(s.n, { items: [], picked: new Set(), checked: false, note: (e as Error).message }));
    } finally {
      setWorking((w) => {
        const next = new Set(w);
        next.delete(s.n);
        return next;
      });
    }
  }

  async function suggestAll() {
    stop();
    const ctl = (abort.current = new AbortController());
    const todo = shown.filter((s) => !found.has(s.n) && !chosen.has(s.n));
    for (let i = 0; i < todo.length && !ctl.signal.aborted; i++) {
      setBusy(`Finding papers for sentence ${i + 1} of ${todo.length}`);
      await suggest(todo[i], ctl.signal);
    }
    setBusy(null);
  }

  function toggle(n: number, id: string) {
    const f = found.get(n);
    if (!f) return;
    const picked = new Set(f.picked);
    picked.has(id) ? picked.delete(id) : picked.add(id);
    setFound(new Map(found).set(n, { ...f, picked }));
  }

  /** Add the ticked papers that are new, and put their keys into the sentence. */
  function cite(n: number) {
    const f = found.get(n);
    if (!f) return;
    const keys: string[] = [];
    let failed = 0;
    for (const item of f.items.filter((x) => f.picked.has(x.paper.id))) {
      const p = item.outside ? props.onAdd(item.outside.draft) : item.paper;
      if (p?.key) keys.push(p.key);
      else failed++;
    }
    if (keys.length) setChosen(new Map(chosen).set(n, keys));
    if (failed) setNote(`${failed} paper${failed === 1 ? "" : "s"} could not be added (is the library read-only?).`);
  }

  function uncite(n: number) {
    const next = new Map(chosen);
    next.delete(n);
    setChosen(next);
  }

  function bib() {
    const { found: cited } = papersForKeys(props.papers, citeKeysIn(out));
    return cited.length ? libraryToBibtex(cited) : "";
  }

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(() => setNote(`Copied ${what}.`), () => setNote("Could not copy."));
  }

  if (editing) {
    return (
      <form onSubmit={read}>
        <p class="muted">
          Open your .tex, or paste a section. Lightkone marks the sentences that make a claim but cite nothing, suggests papers for each from your library and from
          OpenAlex{hasKey ? ", checked by Claude," : ""} and puts the <code>\cite</code> in for you.
        </p>
        <textarea rows={8} value={tex} placeholder={"Recent observations of type Ia supernovae indicate that the expansion of the Universe is accelerating.\n…"} onInput={(e) => setTex(e.currentTarget.value)} />
        <div class="row">
          <label class="pill file">
            Open .tex file
            <input type="file" accept=".tex,.ltx,.txt,text/x-tex,text/plain" hidden onChange={(e) => open(e.currentTarget.files?.[0])} />
          </label>
          {name && <span class="muted small">{name}</span>}
          <button class="primary" type="submit" disabled={!tex.trim()}>Find uncited claims</button>
        </div>
      </form>
    );
  }

  return (
    <div class="cite-draft">
      <div class="row draft-head">
        <span class="muted small">
          {name || "Pasted text"}: {sentences.length} sentences, {sentences.length - uncited.length} with a citation, {triage ? `${[...triage.values()].filter((t) => t.needs).length} need one by Claude's reading` : `${claims.length} read like claims without one`}
          {added ? `; ${added} cited here` : ""}.
        </span>
        <button class="small" onClick={() => { stop(); setEditing(true); }}>Change text</button>
      </div>
      <div class="row">
        {hasKey && !triage && uncited.length > 0 && <button onClick={askClaude} disabled={Boolean(busy)}>Ask Claude which need a citation</button>}
        {shown.length > 0 && <button onClick={suggestAll} disabled={Boolean(busy)}>Find papers for all {shown.length}</button>}
        {busy && <button onClick={() => { stop(); setBusy(null); }}>Stop</button>}
        <label class="check small">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.currentTarget.checked)} /> Show every uncited sentence ({uncited.length})
        </label>
      </div>
      {busy && <p class="message" role="status">{busy}…</p>}
      {note && <p class="message" role="status">{note}</p>}
      {!shown.length && (
        <p class="message">{uncited.length ? "No uncited sentence reads like a claim. Tick Show every uncited sentence to look through them all." : "Every sentence cites something."}</p>
      )}
      <ol class="draft-sentences">
        {shown.map((s) => {
          const f = found.get(s.n);
          const keys = chosen.get(s.n);
          const t = triage?.get(s.n);
          return (
            <li key={s.n} class={keys ? "done" : ""}>
              <div class="draft-line muted small">
                line {s.line}
                {t?.why ? ` · ${t.why}` : s.cues.length ? ` · ${s.cues.join(", ")}` : ""}
              </div>
              <p class="draft-text">
                {s.plain}
                {keys && <code class="cite-in"> \{cmd}{"{"}{keys.join(",")}{"}"}</code>}
              </p>
              {keys ? (
                <div class="row">
                  <button class="small" onClick={() => uncite(s.n)}>Undo</button>
                  <button class="small" onClick={() => suggest(s)} disabled={working.has(s.n)}>Change papers</button>
                </div>
              ) : !f ? (
                <div class="row">
                  <button class="small" onClick={() => suggest(s)} disabled={working.has(s.n)}>{working.has(s.n) ? "Finding…" : "Suggest papers"}</button>
                </div>
              ) : null}
              {f && !keys && (
                <>
                  {f.note && <p class="message small">{f.note}</p>}
                  {f.items.length > 0 && (
                    <ul class="candidates">
                      {f.items.map((x) => (
                        <li key={x.paper.id} class={x.verdict ? `v-${x.verdict.support}` : ""}>
                          <input type="checkbox" checked={f.picked.has(x.paper.id)} onChange={() => toggle(s.n, x.paper.id)} aria-label={`Cite ${x.paper.title}`} />
                          <div>
                            <div class="cand-title">
                              {x.paper.title}
                              {x.verdict && <span class={`verdict ${x.verdict.support}`}>{{ supports: "backs it", related: "related", no: "doesn't back it" }[x.verdict.support]}</span>}
                            </div>
                            <div class="muted small">
                              {[shortAuthors(x.paper.authors), x.paper.year].filter(Boolean).join(" ")} ·{" "}
                              {x.outside ? <span class="new-paper">not in your library{x.outside.cited ? `, cited ${x.outside.cited.toLocaleString()} times` : ""}</span> : <code>{x.paper.key}</code>}
                            </div>
                            <div class="snippet">
                              {!x.outside && (
                                <>
                                  <a href="#" class="page" onClick={(e) => { e.preventDefault(); props.onOpen(x.paper.id, x.passage.page); }}>{x.passage.page ? `p. ${x.passage.page}` : "abstract"}</a>{" "}
                                </>
                              )}
                              {x.verdict?.quote ? `“${x.verdict.quote}”` : x.passage.text.length > 240 ? `${x.passage.text.slice(0, 240)}…` : x.passage.text}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div class="row">
                    {f.items.length > 0 && (
                      <button class="primary small" disabled={!f.picked.size} onClick={() => cite(s.n)}>
                        {(() => {
                          const fresh = f.items.filter((x) => x.outside && f.picked.has(x.paper.id)).length;
                          return f.picked.size ? `Cite ${f.picked.size}${fresh ? `, adding ${fresh} to the library` : ""}` : "Tick papers to cite";
                        })()}
                      </button>
                    )}
                    <button class="small" onClick={() => suggest(s)} disabled={working.has(s.n)}>{working.has(s.n) ? "Finding…" : "Search again"}</button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ol>
      <div class="row draft-out">
        <select value={cmd} onChange={(e) => pickCmd(e.currentTarget.value)} aria-label="Citation command">
          {COMMANDS.map((c) => <option key={c} value={c}>\{c}</option>)}
        </select>
        <button class="primary" disabled={!added} onClick={() => download(out, name || "draft.tex", "application/x-tex")}>Download {name || "draft.tex"}</button>
        <button disabled={!added} onClick={() => copy(out, "the .tex")}>Copy .tex</button>
        <button disabled={!added} onClick={() => { const b = bib(); b ? download(b, "references.bib", "application/x-bibtex") : setNote("None of the cited keys are in your library."); }}>Download .bib</button>
      </div>
    </div>
  );
}
