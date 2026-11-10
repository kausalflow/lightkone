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
  type Seed,
} from "./core/explore";
import { shortAuthors } from "./core/cite";
import { Icon } from "./icons";
import { citationTicks, labelAt, nameOf, usePanZoom } from "./CitationMap";
import { downloadSvg } from "./svgfile";

// Explore: pick seed papers, from the library or outside it, and see the
// works around them in the citation network, placed by year and citations
// and ranked by how tightly they tie to the seeds. Explorations are kept
// with what was seen, so opening one again marks what is new.

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
  seed: Seed | string | null;
  readOnly?: boolean;
  onSeedTaken(): void;
  /** Look a library paper up in OpenAlex; its OpenAlex id, or null. */
  onLookUp(p: Paper): Promise<string | null>;
  onAdd(d: PaperDraft): boolean;
  onOpen(id: string, page: number): void;
}) {
  const [saved, setSaved] = useState<ExploreStore | null>(null);
  const [current, setCurrent] = useState<Exploration | null>(null);
  const [seeds, setSeeds] = useState<Seed[]>([]);
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

  useEffect(() => {
    loadExplorations(props.storage).then(setSaved);
    return () => abort.current?.abort();
  }, [props.storage]);

  // A seed handed over from the map, a paper's details or Missing: start a new exploration with it.
  useEffect(() => {
    if (!props.seed || !saved) return;
    const s = props.seed;
    props.onSeedTaken();
    (async () => {
      const seed = typeof s === "string" ? await seedOf(byId.get(s)) : s;
      if (!seed) return;
      const found = saved.items.find((x) => x.seeds.length === 1 && x.seeds[0].oa === seed.oa);
      if (found) open(found);
      else {
        setCurrent(null);
        setSeeds([seed]);
        run([seed], null);
      }
    })();
  }, [props.seed, saved]);

  async function seedOf(p: Paper | undefined): Promise<Seed | null> {
    if (!p) return null;
    let oa = props.store.works[p.id]?.oa ?? null;
    if (!oa && !props.store.works[p.id]) {
      setBusy("Looking the paper up…");
      oa = await props.onLookUp(p);
      setBusy(null);
    }
    if (!oa) {
      setError(`OpenAlex doesn't know “${p.title}” yet, so it can't be explored from. ${doiOf(p) ? "" : "It needs a DOI or an arXiv id."}`);
      return null;
    }
    return { oa, title: p.title, paperId: p.id };
  }

  async function persist(next: ExploreStore) {
    setSaved({ ...next });
    if (!props.readOnly) await saveExplorations(props.storage, next).catch(() => {});
  }

  async function run(ss: Seed[], ex: Exploration | null) {
    if (!ss.length) return;
    abort.current?.abort();
    abort.current = new AbortController();
    setError(null);
    setPicked(null);
    setMore(PAGE);
    setBusy(`Walking out from ${ss.length > 1 ? `${ss.length} seeds` : "the seed"}…`);
    try {
      const r = await explore(ss, props.store, { key: props.fetchKey, signal: abort.current.signal });
      const seen = new Set(ex?.seen ?? []);
      // The first time, nothing is “new”; after that, whatever wasn't shown before.
      // Papers already in the library are never “new”.
      setFresh(ex?.looked ? new Set(r.candidates.filter((c) => !c.paperId && !seen.has(c.oa)).map((c) => c.oa)) : new Set());
      setResult(r);
      if (ex && saved) {
        const updated = { ...ex, seeds: ss, seen: [...new Set([...ex.seen, ...r.candidates.map((c) => c.oa)])], looked: new Date().toISOString() };
        setCurrent(updated);
        await persist({ ...saved, items: saved.items.map((x) => (x.id === ex.id ? updated : x)) });
      }
    } catch (e) {
      if (!abort.current.signal.aborted) setError((e as Error).message);
    }
    setBusy(null);
  }

  function open(ex: Exploration) {
    setCurrent(ex);
    setSeeds(ex.seeds);
    setFilter({ sort: "ties", hideLibrary: true });
    run(ex.seeds, ex);
  }

  async function keep() {
    if (!saved || !result) return;
    const ex: Exploration = { id: newId(), name: nameFor(seeds), seeds, seen: result.candidates.map((c) => c.oa), made: new Date().toISOString(), looked: new Date().toISOString() };
    setCurrent(ex);
    await persist({ ...saved, items: [ex, ...saved.items] });
  }

  async function forget(ex: Exploration) {
    if (!saved) return;
    await persist({ ...saved, items: saved.items.filter((x) => x.id !== ex.id) });
    if (current?.id === ex.id) {
      setCurrent(null);
      setResult(null);
      setSeeds([]);
    }
  }

  async function rename(ex: Exploration) {
    const name = prompt("Name this exploration", ex.name)?.trim();
    if (!name || !saved) return;
    const updated = { ...ex, name };
    if (current?.id === ex.id) setCurrent(updated);
    await persist({ ...saved, items: saved.items.map((x) => (x.id === ex.id ? updated : x)) });
  }

  function setSeedList(next: Seed[]) {
    setSeeds(next);
    if (current) {
      const updated = { ...current, seeds: next, name: current.name === nameFor(current.seeds) ? nameFor(next) : current.name };
      setCurrent(updated);
      if (saved) persist({ ...saved, items: saved.items.map((x) => (x.id === updated.id ? updated : x)) });
    }
    run(next, current ? { ...current, seeds: next } : null);
  }

  async function addSeed(s: Seed | Paper) {
    const seed = "oa" in s ? (s as Seed) : await seedOf(s as Paper);
    setQuery("");
    if (!seed || seeds.some((x) => x.oa === seed.oa)) return;
    setSeedList([...seeds, seed]);
  }

  const suggestions = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return props.papers
      .filter((p) => !p.trashed && doiOf(p) && !seeds.some((s) => s.paperId === p.id))
      .filter((p) => {
        const hay = `${p.title} ${p.authors.join(" ")} ${p.key} ${p.year ?? ""}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 6);
  }, [query, props.papers, seeds]);

  const shownAll = useMemo(() => (result ? filterCandidates(result.candidates, filter, fresh) : []), [result, filter, fresh]);
  // The picture keeps your own papers among the rest, so you see where the new ones sit.
  const drawn = useMemo(() => (result ? filterCandidates(result.candidates, { ...filter, hideLibrary: false }, fresh).slice(0, SHOWN) : []), [result, filter, fresh]);
  const sel = picked ? result?.candidates.find((c) => c.oa === picked) ?? null : null;
  const selSeed = picked ? result?.seeds.find((s) => s.oa === picked) ?? null : null;

  function add(c: Candidate) {
    if (props.onAdd(c.draft)) setAdded(new Set([...added, c.oa]));
  }

  return (
    <div class="explore">
      {saved && saved.items.length > 0 && (
        <div class="explore-saved" aria-label="Kept explorations">
          {saved.items.map((ex) => (
            <span key={ex.id} class={`explore-chip ${current?.id === ex.id ? "on" : ""}`}>
              <button class="explore-chip-name" onClick={() => open(ex)} title={ex.seeds.map((s) => s.title).join("\n")}>
                <span class="explore-chip-text">{ex.name}</span>
                {current?.id === ex.id && fresh.size > 0 && <span class="new-badge">{fresh.size} new</span>}
              </button>
              <button class="explore-chip-x" onClick={() => rename(ex)} aria-label={`Rename ${ex.name}`}><Icon name="edit" size={13} /></button>
              <button class="explore-chip-x" onClick={() => forget(ex)} aria-label={`Forget ${ex.name}`}><Icon name="x" size={13} /></button>
            </span>
          ))}
          {(current || seeds.length > 0) && (
            <button class="link small explore-new" onClick={() => { setCurrent(null); setSeeds([]); setResult(null); }}>
              + New exploration
            </button>
          )}
        </div>
      )}

      <div class="explore-seeds">
        <span class="small muted">Seeds:</span>
        {seeds.map((s) => (
          <span key={s.oa} class="chip seed-chip" title={s.title}>
            {s.paperId && byId.get(s.paperId) ? nameOf(byId.get(s.paperId)!) : s.title.length > 40 ? `${s.title.slice(0, 38)}…` : s.title}
            <button onClick={() => setSeedList(seeds.filter((x) => x.oa !== s.oa))} aria-label={`Remove ${s.title}`}><Icon name="x" size={12} /></button>
          </span>
        ))}
        <span class="seed-add">
          <input
            type="search"
            value={query}
            placeholder={seeds.length ? "Add another paper" : "Find a paper in your library"}
            aria-label="Add a seed paper"
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && suggestions[0] && addSeed(suggestions[0])}
          />
          {suggestions.length > 0 && (
            <ul class="seed-suggest" role="listbox">
              {suggestions.map((p) => (
                <li key={p.id}>
                  <button onClick={() => addSeed(p)}>
                    <span>{p.title}</span>
                    <span class="muted small">{[shortAuthors(p.authors), p.year].filter(Boolean).join(" ")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </span>
        {result && !current && seeds.length > 0 && !props.readOnly && (
          <button class="primary small-btn" onClick={keep} title="Keep it; opening it later marks what is new since">Keep this exploration</button>
        )}
      </div>

      {busy && (
        <p class="message" role="status">
          {busy} <button class="link" onClick={() => abort.current?.abort()}>Stop</button>
        </p>
      )}
      {error && <p class="error">{error}</p>}

      {!seeds.length && !busy && (
        <div class="explore-empty muted">
          <p>Start from one paper or several. Explore reads what cites them, what they cite, and what shares their references, and ranks each by how closely it ties to your seeds and the rest of your library.</p>
          <p class="small">Tip: on the Map, tap a paper and choose <em>Explore from this</em>. Kept explorations show what is new each time you open them.</p>
        </div>
      )}

      {result && seeds.length > 0 && (
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
              <label class="small map-all"><input type="checkbox" checked={Boolean(filter.onlyNew)} onChange={(e) => setFilter({ ...filter, onlyNew: e.currentTarget.checked })} /> Only new ({fresh.size})</label>
            )}
          </div>
          <ExploreGraph result={result} shown={drawn} fresh={fresh} picked={picked} setPicked={setPicked} />
          {(sel || selSeed) && (
            <div class="map-card">
              {sel ? (
                <CandidateCard c={sel} seeds={result.seeds.length} isNew={fresh.has(sel.oa)} added={added.has(sel.oa)} readOnly={props.readOnly} onAdd={() => add(sel)} onSeed={() => addSeed({ oa: sel.oa, title: sel.draft.title, paperId: sel.paperId })} onOpen={sel.paperId ? () => props.onOpen(sel.paperId!, 0) : undefined} />
              ) : (
                <>
                  <div class="cand-title">{selSeed!.title}</div>
                  <div class="muted small">Seed · {selSeed!.year || "year unknown"} · cited {selSeed!.cited} times</div>
                </>
              )}
            </div>
          )}
          <p class="muted small">
            {shownAll.length} of {result.candidates.length} works around {result.seeds.length > 1 ? `${result.seeds.length} seeds` : "the seed"}{filter.hideLibrary ? ", leaving out the ones you have" : ""}. The picture shows the closest {drawn.length}, yours filled and the rest hollow.
          </p>
          <ul class="candidates explore-list">
            {shownAll.slice(0, more).map((c) => (
              <li key={c.oa} class={`explore-item ${picked === c.oa ? "picked" : ""}`}>
                <CandidateCard c={c} seeds={result.seeds.length} isNew={fresh.has(c.oa)} added={added.has(c.oa)} readOnly={props.readOnly} compact onPick={() => setPicked(c.oa)} onAdd={() => add(c)} onSeed={() => addSeed({ oa: c.oa, title: c.draft.title, paperId: c.paperId })} onOpen={c.paperId ? () => props.onOpen(c.paperId!, 0) : undefined} />
              </li>
            ))}
          </ul>
          {shownAll.length > more && <button class="link" onClick={() => setMore(more + PAGE)}>Show {Math.min(PAGE, shownAll.length - more)} more</button>}
        </>
      )}
    </div>
  );
}

function CandidateCard(props: { c: Candidate; seeds: number; isNew: boolean; added: boolean; readOnly?: boolean; compact?: boolean; onPick?(): void; onAdd(): void; onSeed(): void; onOpen?(): void }) {
  const { c } = props;
  const why = reasons(c, props.seeds);
  return (
    <div class="cand">
      <div class="cand-main">
        <div class="cand-title">
          {props.onPick ? <a href="#" onClick={(e) => { e.preventDefault(); props.onPick!(); }}>{c.draft.title}</a> : c.draft.title}
          {props.isNew && <span class="new-badge">new</span>}
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
        <button onClick={props.onSeed} title="Add to the seeds and walk out from it too">+ Seed</button>
      </div>
    </div>
  );
}

function ExploreGraph(props: { result: Neighbourhood; shown: Candidate[]; fresh: Set<string>; picked: string | null; setPicked(id: string | null): void }) {
  const narrow = typeof window !== "undefined" && window.innerWidth < 640;
  const width = narrow ? 520 : 1000;
  const height = narrow ? 460 : 480;
  const { result, shown, picked } = props;
  const seedIds = new Set(result.seeds.map((s) => s.oa));
  const items = useMemo(() => {
    const rows = [
      ...result.seeds.map((s) => ({ id: s.oa, year: s.year, cited: s.cited, r: 9, refs: s.refs, label: s.title })),
      ...shown.map((c) => ({ id: c.oa, year: c.year, cited: c.cited, r: 3 + Math.min(7, 1.6 * (c.citesSeeds.length + c.citedBySeeds.length) + c.shared / 6 + c.libraryLinks.length * 0.6), refs: c.refs, label: draftName(c.draft) })),
    ].filter((x) => x.year);
    return rows;
  }, [result, shown]);
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
  const labelled = new Set([...seedIds, ...shown.slice(0, narrow ? 5 : 10).map((c) => c.oa), ...(near ?? [])]);
  const span = Math.max(1, years[1] - years[0]);
  const step = span > 40 ? 10 : span > 16 ? 5 : span > 6 ? 2 : 1;
  const ticks: number[] = [];
  for (let y = Math.ceil(years[0] / step) * step; y <= years[1]; y += step) ticks.push(y);

  return (
    <div class="explore-graph">
      <div class="map-tools">
        <span class="muted small">Across by year, up by citations. Bigger means closer ties.</span>
        <span class="legend-key small"><i class="k seed" /> seed <i class="k have" /> in your library <i class="k out" /> not yet <i class="k fresh" /> new</span>
        <button class="icon-btn" onClick={() => zoom(1 / 1.4)} aria-label="Zoom in"><Icon name="plus" /></button>
        <button class="icon-btn" onClick={() => zoom(1.4)} aria-label="Zoom out"><Icon name="minus" /></button>
        <button class="icon-btn" onClick={() => svg.current && downloadSvg(svg.current, { width, height }, "exploration.svg")} aria-label="Download picture" title="Download as an SVG picture"><Icon name="download" /></button>
      </div>
      <svg
        ref={svg}
        class="map explore-map"
        style={{ aspectRatio: `${width} / ${height}` }}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        {...handlers}
        onClick={(e) => !moved.current && (e.target as Element).tagName === "svg" && props.setPicked(null)}
        role="img"
        aria-label="Works around the seeds, by year and citations, linked where one cites another"
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
          return <path key={`${a}>${b}`} d={`M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}`} class={`edge ${on && near ? "on" : ""} ${seedIds.has(a) || seedIds.has(b) ? "to-seed" : ""}`} opacity={on ? undefined : 0.05} />;
        })}
        {plane.spots.map((s) => {
          const c = byOa.get(s.id);
          const kind = seedIds.has(s.id) ? "seed" : c?.paperId ? "have" : "out";
          return (
            <g key={s.id} class={`node x-${kind} ${props.fresh.has(s.id) ? "fresh" : ""} ${picked === s.id ? "picked" : ""}`} opacity={!near || near.has(s.id) ? 1 : 0.25} onClick={(e) => { e.stopPropagation(); if (!moved.current) props.setPicked(s.id === picked ? null : s.id); }}>
              <circle cx={s.x} cy={s.y} r={s.r} />
              <title>{`${c?.draft.title ?? info.get(s.id)?.label} (${s.year}, cited ${s.cited})`}</title>
              {labelled.has(s.id) && (
                <text {...labelAt(s.x, s.r, width)} y={s.y + 3} class="node-label">
                  {seedIds.has(s.id) ? (info.get(s.id)!.label.length > 28 ? `${info.get(s.id)!.label.slice(0, 26)}…` : info.get(s.id)!.label) : info.get(s.id)!.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
