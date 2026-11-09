import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper, PaperDraft } from "./core/types";
import { draftOf, fetchCitations, inLibraryOf, parseStances, stancePrompt, type Citations, type Citing, type Intent, type Stance, type StanceVerdict } from "./core/citedby";
import { shortAuthors } from "./core/cite";
import { sortCitations } from "./plugins/claude";

/** Citing passages sent to Claude in one go. */
const SORT_MAX = 60;
const SHOW_STEP = 40;

const STANCE_LABEL: Record<Stance, string> = { supports: "Supporting", contrasts: "Contrasting", mentions: "Mentioning" };
const INTENT_LABEL: Record<Intent, string> = { background: "Background", methodology: "Method", result: "Result" };

// Kept for the session, so reopening a paper doesn't ask again.
const cache = new Map<string, { citations: Citations; stances: Map<string, StanceVerdict> }>();

type Filter = "all" | Stance | Intent | "library";

/** The sentences in later papers that cite this one, sorted by what those papers do with it. */
export function CitedByPanel(props: {
  paper: Paper;
  papers: Paper[];
  settings: Record<string, string>;
  hidden?: boolean;
  onAdd(d: PaperDraft): boolean;
  onOpen(paperId: string): void;
  onClose(): void;
}) {
  const p = props.paper;
  const cached = cache.get(p.id);
  const [citations, setCitations] = useState<Citations | null>(cached?.citations ?? null);
  const [stances, setStances] = useState<Map<string, StanceVerdict>>(cached?.stances ?? new Map());
  const [error, setError] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(SHOW_STEP);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [withText, setWithText] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const hasKey = Boolean(props.settings["claude.apiKey"]);

  useEffect(() => {
    if (citations) return;
    const ctl = (abort.current = new AbortController());
    fetchCitations(p, { key: props.settings["related.s2Key"] || undefined, signal: ctl.signal })
      .then((c) => {
        setCitations(c);
        cache.set(p.id, { citations: c, stances: new Map() });
      })
      .catch((e) => !ctl.signal.aborted && setError((e as Error).message));
    return () => ctl.abort();
  }, [p.id]);

  const items = citations?.items ?? [];
  const withContexts = items.filter((c) => c.contexts.length);
  const own = useMemo(() => new Map(items.map((c) => [c.id, inLibraryOf(c, props.papers)])), [items, props.papers]);

  const counts = useMemo(() => {
    const n: Partial<Record<Filter, number>> = { all: (withText ? withContexts : items).length };
    for (const c of withText ? withContexts : items) {
      const s = stances.get(c.id)?.stance;
      if (s) n[s] = (n[s] ?? 0) + 1;
      for (const i of c.intents) n[i] = (n[i] ?? 0) + 1;
      if (own.get(c.id)) n.library = (n.library ?? 0) + 1;
    }
    return n;
  }, [items, stances, own, withText]);

  const list = (withText ? withContexts : items).filter((c) => {
    if (filter === "all") return true;
    if (filter === "library") return Boolean(own.get(c.id));
    if (filter === "supports" || filter === "contrasts" || filter === "mentions") return stances.get(c.id)?.stance === filter;
    return c.intents.includes(filter);
  });
  // Once sorted, contrasting and supporting come first.
  const order: Record<Stance, number> = { contrasts: 0, supports: 1, mentions: 2 };
  const sorted = stances.size ? [...list].sort((a, b) => (order[stances.get(a.id)?.stance ?? "mentions"] + (stances.has(a.id) ? 0 : 3)) - (order[stances.get(b.id)?.stance ?? "mentions"] + (stances.has(b.id) ? 0 : 3))) : list;

  async function sort() {
    const todo = withContexts.filter((c) => !stances.has(c.id)).slice(0, SORT_MAX);
    if (!todo.length) return;
    setSorting(true);
    setError(null);
    const ctl = (abort.current = new AbortController());
    try {
      const vs = parseStances(await sortCitations(props.settings, p, stancePrompt(todo), ctl.signal));
      const next = new Map(stances);
      for (const v of vs) {
        const c = todo[v.n - 1];
        if (c) next.set(c.id, v);
      }
      setStances(next);
      if (citations) cache.set(p.id, { citations, stances: next });
      if (!vs.length) setError("Claude's reply could not be read. Try again.");
    } catch (e) {
      if (!ctl.signal.aborted) setError((e as Error).message);
    } finally {
      setSorting(false);
    }
  }

  function add(c: Citing) {
    if (props.onAdd(draftOf(c))) setAdded(new Set(added).add(c.id));
  }

  const chip = (f: Filter, label: string) =>
    (counts[f] ?? 0) > 0 || f === "all" ? (
      <button key={f} class={`pill ${filter === f ? "on" : ""}`} onClick={() => { setFilter(f); setShown(SHOW_STEP); }}>
        {label} <span>{counts[f] ?? 0}</span>
      </button>
    ) : null;

  const unsorted = withContexts.filter((c) => !stances.has(c.id)).length;

  return (
    <div class="overlay" hidden={props.hidden} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel wide citedby-panel">
        <h2>How others cite this</h2>
        <p class="muted small citedby-of">{p.title}{p.year ? ` (${p.year})` : ""}</p>
        {!citations && !error && <p class="message" role="status">Asking Semantic Scholar for the papers that cite it…</p>}
        {error && <p class="message" role="status">{error}</p>}
        {citations && (
          <>
            <p class="muted small">
              {citations.total !== undefined ? `${citations.total.toLocaleString()} papers cite it. ` : ""}
              {items.length < (citations.total ?? 0) ? `Read the newest ${items.length.toLocaleString()}; ` : ""}
              {withContexts.length.toLocaleString()} come with the sentences that cite it, from Semantic Scholar. The influential and much-cited ones are first.
            </p>
            <div class="row citedby-actions">
              {hasKey && unsorted > 0 && (
                <button class="primary" onClick={sort} disabled={sorting}>
                  {sorting ? "Claude is reading them…" : stances.size ? `Sort ${Math.min(unsorted, SORT_MAX)} more with Claude` : `Sort ${Math.min(unsorted, SORT_MAX)} with Claude`}
                </button>
              )}
              {sorting && <button onClick={() => abort.current?.abort()}>Stop</button>}
              <label class="check small">
                <input type="checkbox" checked={!withText} onChange={(e) => { setWithText(!e.currentTarget.checked); setShown(SHOW_STEP); }} /> Include papers without the sentences
              </label>
            </div>
            <div class="chips citedby-filters">
              {chip("all", "All")}
              {chip("supports", "Supporting")}
              {chip("contrasts", "Contrasting")}
              {chip("mentions", "Mentioning")}
              {chip("result", "Result")}
              {chip("methodology", "Method")}
              {chip("background", "Background")}
              {chip("library", "In your library")}
            </div>
            {!sorted.length && <p class="message">{items.length ? "None here." : "Semantic Scholar has no citations of this paper yet."}</p>}
            <ul class="citedby-list">
              {sorted.slice(0, shown).map((c) => {
                const v = stances.get(c.id);
                const mine = own.get(c.id);
                return (
                  <li key={c.id} class={v ? `s-${v.stance}` : ""}>
                    {c.contexts.slice(0, 3).map((s, i) => <blockquote key={i}>{s}</blockquote>)}
                    <div class="citedby-meta">
                      {v && <span class={`verdict ${v.stance}`}>{STANCE_LABEL[v.stance]}</span>}
                      {c.influential && <span class="verdict">Influential</span>}
                      {c.intents.map((i) => <span key={i} class="intent">{INTENT_LABEL[i]}</span>)}
                      {v?.note && <span class="muted small">{v.note}</span>}
                    </div>
                    <div class="citedby-paper">
                      <span class="title">{c.title}</span>
                      <span class="muted small"> {[shortAuthors(c.authors), c.year, c.venue].filter(Boolean).join(" · ")}{c.cited ? ` · cited ${c.cited.toLocaleString()}` : ""}</span>
                    </div>
                    <div class="row">
                      {mine ? (
                        <button class="small" onClick={() => props.onOpen(mine.id)}>Open in your library</button>
                      ) : added.has(c.id) ? (
                        <span class="muted small">Added</span>
                      ) : (
                        <button class="small" onClick={() => add(c)}>Add to library</button>
                      )}
                      {(c.doi || c.arxiv) && (
                        <a class="small" href={c.doi ? `https://doi.org/${c.doi}` : `https://arxiv.org/abs/${c.arxiv}`} target="_blank" rel="noopener">{c.doi ? "DOI" : "arXiv"}</a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            {sorted.length > shown && (
              <div class="row">
                <button onClick={() => setShown(shown + SHOW_STEP)}>Show {Math.min(SHOW_STEP, sorted.length - shown)} more</button>
              </div>
            )}
          </>
        )}
        <div class="row">
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
