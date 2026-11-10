import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper, PaperDraft, StorageAdapter } from "./core/types";
import { doiOf, type CitationStore } from "./core/citations";
import {
  explore,
  filterCandidates,
  loadExplorations,
  nameFor,
  reasons,
  saveExplorations,
  scatter,
  type Candidate,
  type ExploreFilter,
  type ExploreStore,
  type Exploration,
  type Neighbourhood,
  type Root,
} from "./core/explore";
import { shortAuthors } from "./core/cite";
import { Icon } from "./icons";
import { citationTicks, labelAt, nameOf, usePanZoom } from "./CitationMap";
import { downloadSvg } from "./svgfile";

// Branches: grow the library through its citation network. By default the
// roots are the whole library (or a folder): the works that cite or are
// cited by several of your papers, ranked by how tightly they tie to them.
// Or pick a few root papers, from the library or outside it. Kept branches
// remember what was seen, so opening one again marks what is fresh.

const SHOWN = 60;
const PAGE = 30;
const draftName = (d: PaperDraft) => `${shortAuthors(d.authors ?? []).replace(/ et al\.$/, "") || d.title.slice(0, 18)}${d.year ? ` ${d.year}` : ""}`;
const newId = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function ExploreView(props: {
  papers: Paper[];
  store: CitationStore;
  storage: StorageAdapter;
  fetchKey?: string;
  /** A library paper id or an outside work to start from. */
  root: Root | string | null;
  /** Bumped when the citation store changes, as references arrive. */
  version?: number;
  readOnly?: boolean;
  onRootTaken(): void;
  /** Look a library paper up in OpenAlex; its OpenAlex id, or null. */
  onLookUp(p: Paper): Promise<string | null>;
  onAdd(d: PaperDraft): boolean;
  onOpen(id: string, page: number): void;
}) {
  const [saved, setSaved] = useState<ExploreStore | null>(null);
  const [current, setCurrent] = useState<Exploration | null>(null);
  const [roots, setRoots] = useState<Root[]>([]);
  // "library", "folder:<name>", or "pick" for roots chosen one by one.
  const [scope, setScope] = useState(props.root ? "pick" : "library");
  const [result, setResult] = useState<Neighbourhood | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ExploreFilter>({ sort: "ties", hideLibrary: true });
  const [picked, setPicked] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [more, setMore] = useState(PAGE);
  const [query, setQuery] = useState("");
  const abort = useRef<AbortController | null>(null);
  const byId = useMemo(() => new Map(props.papers.map((p) => [p.id, p])), [props.papers]);
  const folders = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of props.papers) for (const f of new Set((p.folders ?? []).map((f) => f.split("/")[0]))) if (!p.trashed && f) count.set(f, (count.get(f) ?? 0) + 1);
    return [...count].sort((a, b) => a[0].localeCompare(b[0]));
  }, [props.papers]);
  const known = Object.values(props.store.works).filter((w) => w.oa).length;

  /** The library papers a library or folder branch grows from: those OpenAlex knows. */
  function scopeRoots(sc: string): Root[] {
    const folder = sc.startsWith("folder:") ? sc.slice(7) : null;
    return props.papers
      .filter((p) => !p.trashed && (!folder || (p.folders ?? []).some((f) => f === folder || f.startsWith(`${folder}/`))))
      .flatMap((p) => {
        const oa = props.store.works[p.id]?.oa;
        return oa ? [{ oa, title: p.title, paperId: p.id }] : [];
      });
  }
  const scopeName = (sc: string) => (sc === "library" ? "Whole library" : sc.startsWith("folder:") ? sc.slice(7) : nameFor(roots));

  useEffect(() => {
    loadExplorations(props.storage).then(setSaved);
    return () => abort.current?.abort();
  }, [props.storage]);

  // Open on the library's own branch: what your papers keep pointing to, and what keeps citing them.
  useEffect(() => {
    if (props.root || !saved || scope === "pick" || result || busy || !known) return;
    run(scopeRoots(scope), current, scope);
  }, [saved, known > 0, props.version]);

  // A root handed over from the map, a paper's details or Missing: start a new exploration with it.
  useEffect(() => {
    if (!props.root || !saved) return;
    const s = props.root;
    props.onRootTaken();
    (async () => {
      const root = typeof s === "string" ? await rootOf(byId.get(s)) : s;
      if (!root) return;
      const found = saved.items.find((x) => x.roots.length === 1 && x.roots[0].oa === root.oa);
      if (found) open(found);
      else {
        setCurrent(null);
        setScope("pick");
        setRoots([root]);
        run([root], null, "pick");
      }
    })();
  }, [props.root, saved]);

  async function rootOf(p: Paper | undefined): Promise<Root | null> {
    if (!p) return null;
    let oa = props.store.works[p.id]?.oa ?? null;
    if (!oa && !props.store.works[p.id]) {
      setBusy("Looking the paper up…");
      oa = await props.onLookUp(p);
      setBusy(null);
    }
    if (!oa) {
      setError(`OpenAlex doesn't know “${p.title}” yet, so you can't branch out from it yet. ${doiOf(p) ? "" : "It needs a DOI or an arXiv id."}`);
      return null;
    }
    return { oa, title: p.title, paperId: p.id };
  }

  async function persist(next: ExploreStore) {
    setSaved({ ...next });
    if (!props.readOnly) await saveExplorations(props.storage, next).catch(() => {});
  }

  async function run(ss: Root[], ex: Exploration | null, sc = scope) {
    if (!ss.length) {
      if (sc !== "pick") setError(sc === "library" ? "None of your papers has references from OpenAlex yet." : "None of this folder's papers has references from OpenAlex yet.");
      return;
    }
    abort.current?.abort();
    abort.current = new AbortController();
    setError(null);
    setPicked(null);
    setMore(PAGE);
    const what = sc === "library" ? `your ${ss.length} papers` : sc.startsWith("folder:") ? `the ${ss.length} papers in ${sc.slice(7)}` : ss.length > 1 ? `${ss.length} roots` : "the root";
    setBusy(`Growing from ${what}…`);
    try {
      const r = await explore(ss, props.store, { key: props.fetchKey, signal: abort.current.signal }, {
        library: sc !== "pick",
        onProgress: (done, total) => total > 2 && setBusy(`Growing from ${what}: ${done} of ${total} steps`),
      });
      const seen = new Set(ex?.seen ?? []);
      // The first time, nothing is “new”; after that, whatever wasn't shown before.
      // Papers already in the library are never “new”.
      setFresh(ex?.looked ? new Set(r.candidates.filter((c) => !c.paperId && !seen.has(c.oa)).map((c) => c.oa)) : new Set());
      setResult(r);
      if (ex && saved) {
        const updated = { ...ex, roots: ex.scope ? [] : ss, seen: [...new Set([...ex.seen, ...r.candidates.map((c) => c.oa)])], looked: new Date().toISOString() };
        setCurrent(updated);
        await persist({ ...saved, items: saved.items.map((x) => (x.id === ex.id ? updated : x)) });
      }
    } catch (e) {
      if (!abort.current.signal.aborted) setError((e as Error).message);
    }
    setBusy(null);
  }

  function open(ex: Exploration) {
    const sc = ex.scope ?? "pick";
    const rs = ex.scope ? scopeRoots(ex.scope) : ex.roots;
    setCurrent(ex);
    setScope(sc);
    setRoots(sc === "pick" ? rs : []);
    setFilter({ sort: "ties", hideLibrary: true });
    run(rs, ex, sc);
  }

  function choose(sc: string) {
    abort.current?.abort();
    setScope(sc);
    setCurrent(null);
    setResult(null);
    setFresh(new Set());
    setError(null);
    setRoots([]);
    if (sc !== "pick") run(scopeRoots(sc), null, sc);
  }

  async function keep() {
    if (!saved || !result) return;
    const pick = scope === "pick";
    const ex: Exploration = { id: newId(), name: scopeName(scope), ...(pick ? {} : { scope }), roots: pick ? roots : [], seen: result.candidates.map((c) => c.oa), made: new Date().toISOString(), looked: new Date().toISOString() };
    setCurrent(ex);
    await persist({ ...saved, items: [ex, ...saved.items] });
  }

  async function forget(ex: Exploration) {
    if (!saved) return;
    await persist({ ...saved, items: saved.items.filter((x) => x.id !== ex.id) });
    if (current?.id === ex.id) {
      setCurrent(null);
      setResult(null);
      setRoots([]);
      setScope("pick");
    }
  }

  async function rename(ex: Exploration) {
    const name = prompt("Name this branch", ex.name)?.trim();
    if (!name || !saved) return;
    const updated = { ...ex, name };
    if (current?.id === ex.id) setCurrent(updated);
    await persist({ ...saved, items: saved.items.map((x) => (x.id === ex.id ? updated : x)) });
  }

  function setRootList(next: Root[]) {
    setRoots(next);
    if (current) {
      const updated = { ...current, roots: next, name: current.name === nameFor(current.roots) ? nameFor(next) : current.name };
      setCurrent(updated);
      if (saved) persist({ ...saved, items: saved.items.map((x) => (x.id === updated.id ? updated : x)) });
    }
    run(next, current ? { ...current, roots: next } : null);
  }

  async function addRoot(s: Root | Paper) {
    const root = "oa" in s ? (s as Root) : await rootOf(s as Paper);
    setQuery("");
    if (!root || roots.some((x) => x.oa === root.oa)) return;
    if (scope !== "pick") {
      // Picking a root leaves the library branch for one of your own.
      setScope("pick");
      setCurrent(null);
      setRoots([root]);
      run([root], null, "pick");
      return;
    }
    setRootList([...roots, root]);
  }

  const suggestions = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return props.papers
      .filter((p) => !p.trashed && doiOf(p) && !roots.some((s) => s.paperId === p.id))
      .filter((p) => {
        const hay = `${p.title} ${p.authors.join(" ")} ${p.key} ${p.year ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 6);
  }, [query, props.papers, roots]);

  const shownAll = useMemo(() => (result ? filterCandidates(result.candidates, filter, fresh) : []), [result, filter, fresh]);
  // The picture keeps your own papers among the rest, so you see where the new ones sit.
  const drawn = useMemo(() => (result ? filterCandidates(result.candidates, { ...filter, hideLibrary: false }, fresh).slice(0, SHOWN) : []), [result, filter, fresh]);
  const sel = picked ? result?.candidates.find((c) => c.oa === picked) ?? null : null;
  const selRoot = picked ? result?.roots.find((s) => s.oa === picked) ?? null : null;

  function add(c: Candidate) {
    if (props.onAdd(c.draft)) setAdded(new Set([...added, c.oa]));
  }

  return (
    <div class="explore">
      {saved && saved.items.length > 0 && (
        <div class="explore-saved" aria-label="Kept branches">
          {saved.items.map((ex) => (
            <span key={ex.id} class={`explore-chip ${current?.id === ex.id ? "on" : ""}`}>
              <button class="explore-chip-name" onClick={() => open(ex)} title={ex.scope ? scopeName(ex.scope) : ex.roots.map((s) => s.title).join("\n")}>
                <span class="explore-chip-text">{ex.name}</span>
                {current?.id === ex.id && fresh.size > 0 && <span class="new-badge">{fresh.size} fresh</span>}
              </button>
              <button class="explore-chip-x" onClick={() => rename(ex)} aria-label={`Rename ${ex.name}`}><Icon name="edit" size={13} /></button>
              <button class="explore-chip-x" onClick={() => forget(ex)} aria-label={`Forget ${ex.name}`}><Icon name="x" size={13} /></button>
            </span>
          ))}
          {current && (
            <button class="link small explore-new" onClick={() => choose(scope === "pick" ? "pick" : scope)}>
              + New branch
            </button>
          )}
        </div>
      )}

      <div class="explore-roots">
        <label class="small muted grow-from">
          Grow from{" "}
          <select value={scope} onChange={(e) => choose(e.currentTarget.value)} aria-label="Grow from">
            <option value="library">your whole library</option>
            {folders.map(([f, n]) => <option key={f} value={`folder:${f}`}>{f} ({n})</option>)}
            <option value="pick">papers I pick</option>
          </select>
        </label>
        {scope !== "pick" && (
          <span class="small muted">
            {known ? `${scopeRoots(scope).length} papers with references as roots; works tied to two or more of them are shown.` : "Looking up your papers' references first…"}
          </span>
        )}
        {scope === "pick" && roots.map((s) => (
          <span key={s.oa} class="chip root-chip" title={s.title}>
            {s.paperId && byId.get(s.paperId) ? nameOf(byId.get(s.paperId)!) : s.title.length > 40 ? `${s.title.slice(0, 38)}…` : s.title}
            <button onClick={() => setRootList(roots.filter((x) => x.oa !== s.oa))} aria-label={`Remove ${s.title}`}><Icon name="x" size={12} /></button>
          </span>
        ))}
        {scope === "pick" && <span class="root-add">
          <input
            type="search"
            value={query}
            placeholder={roots.length ? "Add another paper" : "Find a paper in your library"}
            aria-label="Add a root paper"
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && suggestions[0] && addRoot(suggestions[0])}
          />
          {suggestions.length > 0 && (
            <ul class="root-suggest" role="listbox">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button onClick={() => addRoot(p)}>
                    <span>{p.title}</span>
                    <span class="muted small">{[shortAuthors(p.authors), p.year].filter(Boolean).join(" ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>}
        {result && !current && (scope !== "pick" || roots.length > 0) && !props.readOnly && (
          <button class="primary small-btn" onClick={keep} title="Keep it; opening it later marks what is fresh since">Keep this branch</button>
        )}
      </div>

      {busy && (
        <p class="message" role="status">
          {busy} <button class="link" onClick={() => abort.current?.abort()}>Stop</button>
        </p>
      )}
      {error && <p class="error">{error}</p>}

      {scope === "pick" && !roots.length && !busy && (
        <div class="explore-empty muted">
          <p>Pick one paper or several as roots. Branching out reads what cites them, what they cite, and what shares their references, and ranks each by how closely it ties to the roots and the rest of your library.</p>
          <p class="small">Tip: on the Map, tap a paper and choose <em>Branch out from this</em>. Kept branches mark what is fresh each time you open them.</p>
        </div>
      )}

      {result && (scope !== "pick" || roots.length > 0) && (
        <>
          <div class="explore-filters">
            <input type="search" placeholder="Filter by words" value={filter.text ?? ""} onInput={(e) => setFilter({ ...filter, text: e.currentTarget.value })} aria-label="Filter by words" />
            <span class="years">
              <input type="number" inputMode="numeric" placeholder="From" value={filter.from ?? ""} onInput={(e) => setFilter({ ...filter, from: Number(e.currentTarget.value) || undefined })} aria-label="From year" />
              –
              <input type="number" inputMode="numeric" placeholder="To" value={filter.to ?? ""} onInput={(e) => setFilter({ ...filter, to: Number(e.currentTarget.value) || undefined })} aria-label="To year" />
            </span>
            <select value={filter.sort} onChange={(e) => setFilter({ ...filter, sort: e.currentTarget.value as ExploreFilter["sort"] })} aria-label="Order">
              <option value="ties">Closest ties</option>
              <option value="cited">Most cited</option>
              <option value="newest">Newest</option>
            </select>
            <label class="small map-all"><input type="checkbox" checked={Boolean(filter.hideLibrary)} onChange={(e) => setFilter({ ...filter, hideLibrary: e.currentTarget.checked })} /> Hide ones I have</label>
            {fresh.size > 0 && (
              <label class="small map-all"><input type="checkbox" checked={Boolean(filter.onlyNew)} onChange={(e) => setFilter({ ...filter, onlyNew: e.currentTarget.checked })} /> Only fresh ({fresh.size})</label>
            )}
          </div>
          <ExploreGraph result={result} shown={drawn} fresh={fresh} picked={picked} setPicked={setPicked} />
          {(sel || selRoot) && (
            <div class="map-card">
              {sel ? (
                <CandidateCard c={sel} roots={result.roots.length} library={result.library} isNew={fresh.has(sel.oa)} added={added.has(sel.oa)} readOnly={props.readOnly} onAdd={() => add(sel)} onRoot={() => addRoot({ oa: sel.oa, title: sel.draft.title, paperId: sel.paperId })} onOpen={sel.paperId ? () => props.onOpen(sel.paperId!, 0) : undefined} />
              ) : (
                <>
                  <div class="cand-title">{selRoot!.title}</div>
                  <div class="muted small">Root · {selRoot!.year || "year unknown"} · cited {selRoot!.cited} times</div>
                </>
              )}
            </div>
          )}
          <p class="muted small">
            {shownAll.length} of {result.candidates.length} works {result.library ? "tied to two or more of your papers" : `around ${result.roots.length > 1 ? `${result.roots.length} roots` : "the root"}`}{filter.hideLibrary && !result.library ? ", leaving out the ones you have" : ""}. The picture shows the closest {drawn.length}{result.roots.length > 25 ? " and the papers of yours they tie to most" : ""}.
          </p>
          <ul class="candidates explore-list">
            {shownAll.slice(0, more).map((c) => (
              <li key={c.oa} class={`explore-item ${picked === c.oa ? "picked" : ""}`}>
                <CandidateCard c={c} roots={result.roots.length} library={result.library} isNew={fresh.has(c.oa)} added={added.has(c.oa)} readOnly={props.readOnly} compact onPick={() => setPicked(c.oa)} onAdd={() => add(c)} onRoot={() => addRoot({ oa: c.oa, title: c.draft.title, paperId: c.paperId })} onOpen={c.paperId ? () => props.onOpen(c.paperId!, 0) : undefined} />
              </li>
            ))}
          </ul>
          {shownAll.length > more && <button class="link" onClick={() => setMore(more + PAGE)}>Show {Math.min(PAGE, shownAll.length - more)} more</button>}
        </>
      )}
    </div>
  );
}

function CandidateCard(props: { c: Candidate; roots: number; library?: boolean; isNew: boolean; added: boolean; readOnly?: boolean; compact?: boolean; onPick?(): void; onAdd(): void; onRoot(): void; onOpen?(): void }) {
  const { c } = props;
  const why = reasons(c, props.roots, props.library);
  return (
    <div class="cand">
      <div class="cand-main">
        <div class="cand-title">
          {props.onPick ? <a href="#" onClick={(e) => { e.preventDefault(); props.onPick!(); }}>{c.draft.title}</a> : c.draft.title}
          {props.isNew && <span class="new-badge">fresh</span>}
        </div>
        <div class="muted small">
          {[shortAuthors(c.draft.authors ?? []), c.year || null, c.draft.venue].filter(Boolean).join(" · ")} · cited {c.cited.toLocaleString()} times
        </div>
        {why.length > 0 && <div class="small why">{why.join(" · ")}</div>}
        {!props.compact && c.draft.abstract && <p class="small abstract-snip">{c.draft.abstract.slice(0, 420)}{c.draft.abstract.length > 420 ? "…" : ""}</p>}
      </div>
      <div class="cand-actions">
        {c.paperId ? (
          props.onOpen && <button onClick={props.onOpen}>Open</button>
        ) : (
          <button class={props.added ? "" : "primary"} disabled={props.added || props.readOnly} onClick={props.onAdd}>{props.added ? "Added" : "Add"}</button>
        )}
        <button onClick={props.onRoot} title="Add to the roots and walk out from it too">+ Root</button>
      </div>
    </div>
  );
}

function ExploreGraph(props: { result: Neighbourhood; shown: Candidate[]; fresh: Set<string>; picked: string | null; setPicked(id: string | null): void }) {
  // Narrow by the room the panel has (a phone, or snapped to the side), not the window.
  const box = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(typeof window !== "undefined" && window.innerWidth < 640);
  useEffect(() => {
    if (!box.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 640));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const width = narrow ? 520 : 1000;
  const height = narrow ? 460 : 480;
  const { result, shown, picked } = props;
  const rootIds = new Set(result.roots.map((s) => s.oa));
  // A library branch's roots are your own papers: drawn, but only the picked one named.
  const rootLabel = new Set(result.library || result.roots.length > 25 ? [] : result.roots.map((s) => s.oa));
  // With many roots (a library branch), draw only the roots the shown works tie to most.
  const drawnRoots = useMemo(() => {
    if (result.roots.length <= 25) return result.roots;
    const ties = new Map<string, number>();
    for (const c of shown) for (const id of [...c.citesRoots, ...c.citedByRoots]) ties.set(id, (ties.get(id) ?? 0) + 1);
    return result.roots.filter((r) => ties.has(r.oa)).sort((a, b) => ties.get(b.oa)! - ties.get(a.oa)!).slice(0, 25);
  }, [result, shown]);
  const many = result.roots.length > 25;
  const items = useMemo(() => {
    const rows = [
      ...drawnRoots.map((s) => ({ id: s.oa, year: s.year, cited: s.cited, r: many ? 5 : 9, refs: s.refs, label: s.paperId ? s.title : s.title })),
      ...shown.map((c) => ({ id: c.oa, year: c.year, cited: c.cited, r: 3 + Math.min(7, 1.6 * (c.citesRoots.length + c.citedByRoots.length) + c.shared / 6 + c.libraryLinks.length * 0.6), refs: c.refs, label: draftName(c.draft) })),
    ].filter((x) => x.year);
    return rows;
  }, [drawnRoots, shown]);
  const years = useMemo((): [number, number] => {
    const ys = items.map((i) => i.year);
    return ys.length ? [Math.min(...ys) - 1, Math.max(...ys) + 1] : [2000, 2026];
  }, [items]);
  const plane = useMemo(() => scatter(items, { width, height, years }), [items, width, height, years]);
  const at = new Map(plane.spots.map((s) => [s.id, s]));
  const info = new Map(items.map((i) => [i.id, i]));
  const edges = useMemo(() => {
    const out: [string, string][] = [];
    for (const i of items) for (const r of i.refs) if (at.has(r) && r !== i.id) out.push([i.id, r]);
    return out;
  }, [items, plane]);
  const { view, svg, moved, zoom, handlers } = usePanZoom(width, height);
  const near = picked ? new Set([picked, ...edges.filter(([a, b]) => a === picked || b === picked).flat()]) : null;
  const byOa = new Map(shown.map((c) => [c.oa, c]));
  const labelled = new Set([...rootLabel, ...shown.slice(0, narrow ? 5 : 10).map((c) => c.oa), ...(near ?? [])]);
  const span = Math.max(1, years[1] - years[0]);
  const step = span > 40 ? 10 : span > 16 ? 5 : span > 6 ? 2 : 1;
  const ticks: number[] = [];
  for (let y = Math.ceil(years[0] / step) * step; y <= years[1]; y += step) ticks.push(y);

  return (
    <div class="explore-graph" ref={box}>
      <div class="map-tools">
        <span class="muted small">Across by year, up by citations. Bigger means closer ties.</span>
        <span class="legend-key small"><i class="k root" /> root <i class="k have" /> in your library <i class="k out" /> not yet <i class="k fresh" /> fresh</span>
        <button class="icon-btn" onClick={() => zoom(1 / 1.4)} aria-label="Zoom in"><Icon name="plus" /></button>
        <button class="icon-btn" onClick={() => zoom(1.4)} aria-label="Zoom out"><Icon name="minus" /></button>
        <button class="icon-btn" onClick={() => svg.current && downloadSvg(svg.current, { width, height }, "branch.svg")} aria-label="Download picture" title="Download as an SVG picture"><Icon name="download" /></button>
      </div>
      <svg
        ref={svg}
        class="map explore-map"
        style={{ aspectRatio: `${width} / ${height}` }}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        {...handlers}
        onClick={(e) => !moved.current && (e.target as Element).tagName === "svg" && props.setPicked(null)}
        role="img"
        aria-label="Works around the roots, by year and citations, linked where one cites another"
      >
        {citationTicks(plane.top, plane.low).map((t) => (
          <g key={`c${t}`}>
            <line x1={0} x2={width} y1={plane.yOf(t)} y2={plane.yOf(t)} class="tick" />
            <text x={view.x + 4} y={plane.yOf(t) - 3} class="axis-label">{t ? t.toLocaleString() : "0"}</text>
          </g>
        ))}
        {ticks.map((t) => <text key={t} x={plane.xOf(t)} y={height - 4} class="tick-label">{t}</text>)}
        {edges.map(([a, b]) => {
          const p = at.get(a)!;
          const q = at.get(b)!;
          const on = !near || a === picked || b === picked;
          const mx = (p.x + q.x) / 2 - (q.y - p.y) * 0.18;
          const my = (p.y + q.y) / 2 + (q.x - p.x) * 0.18;
          return <path key={`${a}>${b}`} d={`M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}`} class={`edge ${on && near ? "on" : ""} ${rootIds.has(a) || rootIds.has(b) ? "to-root" : ""}`} opacity={on ? undefined : 0.05} />;
        })}
        {plane.spots.map((s) => {
          const c = byOa.get(s.id);
          const kind = rootIds.has(s.id) ? "root" : c?.paperId ? "have" : "out";
          return (
            <g key={s.id} class={`node x-${kind} ${props.fresh.has(s.id) ? "fresh" : ""} ${picked === s.id ? "picked" : ""}`} opacity={!near || near.has(s.id) ? 1 : 0.25} onClick={(e) => { e.stopPropagation(); if (!moved.current) props.setPicked(s.id === picked ? null : s.id); }}>
              <circle cx={s.x} cy={s.y} r={s.r} />
              <title>{`${c?.draft.title ?? info.get(s.id)?.label} (${s.year}, cited ${s.cited})`}</title>
              {labelled.has(s.id) && (
                <text {...labelAt(s.x, s.r, width)} y={s.y + 3} class="node-label">
                  {rootIds.has(s.id) ? (info.get(s.id)!.label.length > 28 ? `${info.get(s.id)!.label.slice(0, 26)}…` : info.get(s.id)!.label) : info.get(s.id)!.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
