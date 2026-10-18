import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper, PaperDraft, StorageAdapter } from "./core/types";
import { buildGraph, fetchCitations, layout, loadCitations, needsFetch, saveCitations, worksById, type CitationStore } from "./core/citations";
import { shortAuthors } from "./core/cite";
import { Icon } from "./icons";

// The citation map panel: your papers by year, in bands by folder (or tag),
// linked where one cites another; and the works your papers keep citing
// that you do not have yet.

const COLORS = ["#4e79a7", "#e8853a", "#59a14f", "#d9534f", "#5fa8a3", "#c9a227", "#a8729a", "#8d6e5a"];
const WIDTH = 1000;

const groupOf = (p: Paper) => p.folders?.[0]?.split("/")[0] || p.tags[0] || "";
const nameOf = (p: Paper) => `${shortAuthors(p.authors).replace(/ et al\.$/, "") || p.title.slice(0, 18)}${p.year ? ` ${p.year}` : ""}`;

export function CitationMap(props: {
  papers: Paper[];
  storage: StorageAdapter;
  settings: Record<string, string>;
  hidden?: boolean;
  onOpen(paperId: string, page: number): void;
  onAdd(d: PaperDraft): boolean;
  onClose(): void;
}) {
  const [store, setStore] = useState<CitationStore | null>(null);
  const [tab, setTab] = useState<"map" | "missing">("map");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const key = props.settings["related.openalexKey"] || undefined;

  useEffect(() => {
    loadCitations(props.storage).then((s) => {
      setStore(s);
      if (needsFetch(props.papers, s).length) update(s);
    });
    return () => abort.current?.abort();
  }, [props.storage]);

  async function update(s = store!) {
    abort.current = new AbortController();
    setError(null);
    setBusy("Looking up references…");
    try {
      await fetchCitations(props.papers, s, { key, signal: abort.current.signal }, (done, total) => setBusy(`Looking up references: ${done} of ${total}`));
    } catch (e) {
      if (!abort.current.signal.aborted) setError((e as Error).message);
    }
    // Keep whatever arrived, even after an error.
    await saveCitations(props.storage, s).catch(() => {});
    setStore(s);
    setVersion((v) => v + 1);
    setBusy(null);
  }

  const graph = useMemo(() => (store ? buildGraph(props.papers, store) : null), [store, version, props.papers.length]);
  const todo = store ? needsFetch(props.papers, store).length : 0;

  return (
    <div class="overlay" hidden={props.hidden} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel wide map-panel">
        <div class="ask-head">
          <h2>Citation map</h2>
          <button class="icon-btn" onClick={props.onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "map"} class={tab === "map" ? "on" : ""} onClick={() => setTab("map")}>Map</button>
          <button role="tab" aria-selected={tab === "missing"} class={tab === "missing" ? "on" : ""} onClick={() => setTab("missing")}>
            Missing from your library{graph?.missing.length ? ` (${graph.missing.length})` : ""}
          </button>
        </div>
        {busy && (
          <p class="message" role="status">
            {busy} <button class="link" onClick={() => abort.current?.abort()}>Stop</button>
          </p>
        )}
        {error && <p class="error">{error}</p>}
        {!busy && todo > 0 && store && (
          <p class="muted small">
            {todo} paper{todo > 1 ? "s haven't" : " hasn't"} been looked up yet. <button class="link" onClick={() => update()}>Look them up</button>
          </p>
        )}
        {graph && tab === "map" && <MapView graph={graph} all={all} setAll={setAll} picked={picked} setPicked={setPicked} onOpen={props.onOpen} />}
        {graph && tab === "missing" && <MissingList graph={graph} papers={props.papers} fetchKey={key} onAdd={props.onAdd} />}
      </div>
    </div>
  );
}

function MapView(props: {
  graph: ReturnType<typeof buildGraph>;
  all: boolean;
  setAll(v: boolean): void;
  picked: string | null;
  setPicked(id: string | null): void;
  onOpen(id: string, page: number): void;
}) {
  const { graph, picked } = props;
  const ids = useMemo(
    () => [...graph.nodes.values()].filter((n) => n.year && (props.all ? graph.known && n.paper : n.cites.length + n.citedBy.length > 0)).map((n) => n.paper.id),
    [graph, props.all],
  );
  // The biggest groups get a band each; the rest share the last one.
  const groups = useMemo(() => {
    const count = new Map<string, number>();
    for (const id of ids) {
      const g = groupOf(graph.nodes.get(id)!.paper);
      count.set(g, (count.get(g) ?? 0) + 1);
    }
    const named = [...count].filter(([g]) => g).sort((a, b) => b[1] - a[1]);
    const top = named.slice(0, COLORS.length - 1).map(([g]) => g);
    const rest = named.length > top.length || count.has("");
    return { names: rest ? [...top, top.length ? "Other" : "All papers"] : top, index: new Map(top.map((g, i) => [g, i])) };
  }, [ids]);
  const bands = Math.max(1, groups.names.length);
  const bandHeight = Math.max(70, Math.min(150, 560 / bands));
  const years = useMemo((): [number, number] => {
    const ys = ids.map((id) => graph.nodes.get(id)!.year);
    return ys.length ? [Math.min(...ys) - 1, Math.max(...ys) + 1] : [2000, 2025];
  }, [ids]);
  const placed = useMemo(
    () => layout(graph, ids, (p) => groups.index.get(groupOf(p)) ?? bands - 1, bands, { width: WIDTH, bandHeight, years }),
    [graph, ids, groups],
  );
  const at = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const height = bands * bandHeight + 30;
  const [view, setView] = useState({ x: 0, y: 0, w: WIDTH, h: height });
  useEffect(() => setView({ x: 0, y: 0, w: WIDTH, h: height }), [height]);
  const svg = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);

  const near = picked ? new Set([picked, ...graph.nodes.get(picked)!.cites, ...graph.nodes.get(picked)!.citedBy]) : null;
  const labelled = new Set(
    [...ids].sort((a, b) => {
      const d = (k: string) => graph.nodes.get(k)!.citedBy.length * 2 + graph.nodes.get(k)!.cites.length;
      return d(b) - d(a);
    }).slice(0, 12),
  );
  if (near) near.forEach((k) => labelled.add(k));

  function zoom(f: number, cx = view.x + view.w / 2, cy = view.y + view.h / 2) {
    const w = Math.min(WIDTH * 1.5, Math.max(80, view.w * f));
    const h = (w / view.w) * view.h;
    setView({ x: cx - ((cx - view.x) * w) / view.w, y: cy - ((cy - view.y) * h) / view.h, w, h });
  }
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const b = svg.current!.getBoundingClientRect();
    return { x: view.x + ((e.clientX - b.left) / b.width) * view.w, y: view.y + ((e.clientY - b.top) / b.height) * view.h };
  };
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = toSvg(e);
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  }
  function onDown(e: PointerEvent) {
    moved.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  function onMove(e: PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const b = svg.current!.getBoundingClientRect();
    if (pointers.current.size === 1) {
      const dx = ((e.clientX - prev.x) / b.width) * view.w;
      const dy = ((e.clientY - prev.y) / b.height) * view.h;
      if (Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) > 2) moved.current = true;
      if (moved.current) setView({ ...view, x: view.x - dx, y: view.y - dy });
    } else if (pointers.current.size === 2) {
      // Pinch: zoom by the change in distance between the two fingers.
      const [a, c] = [...pointers.current.entries()].map(([id, p]) => (id === e.pointerId ? { x: e.clientX, y: e.clientY } : p));
      const [a0, c0] = [...pointers.current.values()];
      const d1 = Math.hypot(a.x - c.x, a.y - c.y);
      const d0 = Math.hypot(a0.x - c0.x, a0.y - c0.y);
      if (d0 > 0 && d1 > 0) zoom(d0 / d1, ...Object.values(toSvg({ clientX: (a.x + c.x) / 2, clientY: (a.y + c.y) / 2 })) as [number, number]);
      moved.current = true;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  const onUp = (e: PointerEvent) => pointers.current.delete(e.pointerId);

  const y0 = years[0];
  const span = Math.max(1, years[1] - years[0]);
  const step = span > 40 ? 10 : span > 16 ? 5 : span > 6 ? 2 : 1;
  const ticks: number[] = [];
  for (let y = Math.ceil(y0 / step) * step; y <= years[1]; y += step) ticks.push(y);
  const xOf = (year: number) => 40 + ((year - y0) / span) * (WIDTH - 80);
  const sel = picked ? graph.nodes.get(picked) : null;

  if (!graph.known) return <p class="muted">No references yet. Papers need a DOI or an arXiv id to be looked up.</p>;
  if (!ids.length)
    return (
      <p class="muted">
        None of the {graph.known} papers looked up cite each other yet. <button class="link" onClick={() => props.setAll(true)}>Show them anyway</button>
      </p>
    );

  return (
    <>
      <div class="map-tools">
        <span class="muted small">
          {ids.length} papers, {graph.edges.filter(([a, b]) => at.has(a) && at.has(b)).length} links. Higher and bigger means more cited.
        </span>
        <label class="small map-all">
          <input type="checkbox" checked={props.all} onChange={(e) => props.setAll(e.currentTarget.checked)} /> Show unlinked papers
        </label>
        <button class="icon-btn" onClick={() => zoom(1 / 1.4)} aria-label="Zoom in"><Icon name="plus" /></button>
        <button class="icon-btn" onClick={() => zoom(1.4)} aria-label="Zoom out"><Icon name="minus" /></button>
      </div>
      <svg
        ref={svg}
        class="map"
        style={{ aspectRatio: `${WIDTH} / ${height}` }}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={(e) => !moved.current && (e.target as Element).tagName === "svg" && props.setPicked(null)}
        role="img"
        aria-label="Papers in your library by year, linked where one cites another"
      >
        {groups.names.map((name, i) => (
          <g key={name}>
            <rect x={-2000} y={i * bandHeight} width={WIDTH + 4000} height={bandHeight} class={`band ${i % 2 ? "odd" : ""}`} />
            <text x={view.x + 6} y={i * bandHeight + 14} class="band-label" fill={COLORS[i % COLORS.length]}>{name}</text>
          </g>
        ))}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={xOf(t)} x2={xOf(t)} y1={0} y2={bands * bandHeight} class="tick" />
            <text x={xOf(t)} y={bands * bandHeight + 18} class="tick-label">{t}</text>
          </g>
        ))}
        {graph.edges.map(([a, b]) => {
          const p = at.get(a);
          const q = at.get(b);
          if (!p || !q) return null;
          const on = !near || picked === a || picked === b;
          // Curve to the left of the direction of travel, as in kirsche's charts.
          const mx = (p.x + q.x) / 2 - (q.y - p.y) * 0.2;
          const my = (p.y + q.y) / 2 + (q.x - p.x) * 0.2;
          return <path key={`${a}>${b}`} d={`M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}`} class={`edge ${on && near ? "on" : ""}`} opacity={on ? undefined : 0.06} />;
        })}
        {placed.map((p) => {
          const n = graph.nodes.get(p.id)!;
          return (
            <g key={p.id} class={`node ${picked === p.id ? "picked" : ""}`} opacity={!near || near.has(p.id) ? 1 : 0.25} onClick={(e) => { e.stopPropagation(); if (!moved.current) props.setPicked(p.id === picked ? null : p.id); }}>
              <circle cx={p.x} cy={p.y} r={p.r} fill={COLORS[p.band % COLORS.length]} />
              <title>{`${n.paper.title} (${n.year})`}</title>
              {labelled.has(p.id) && <text x={p.x + p.r + 3} y={p.y + 3} class="node-label">{nameOf(n.paper)}</text>}
            </g>
          );
        })}
      </svg>
      {sel ? (
        <div class="map-card">
          <div class="cand-title">{sel.paper.title}</div>
          <div class="muted small">
            {[shortAuthors(sel.paper.authors), sel.year].filter(Boolean).join(" ")} · cited {sel.cited} times
          </div>
          <PaperLinks label="Cites, in your library" ids={sel.cites} graph={graph} pick={props.setPicked} />
          <PaperLinks label="Cited by, in your library" ids={sel.citedBy} graph={graph} pick={props.setPicked} />
          <div class="row">
            <button class="primary" onClick={() => props.onOpen(sel.paper.id, 0)}>Open paper</button>
          </div>
        </div>
      ) : (
        <p class="muted small">Tap a paper to see what it cites and what cites it. Drag to move, pinch or scroll to zoom.</p>
      )}
    </>
  );
}

function PaperLinks(props: { label: string; ids: string[]; graph: ReturnType<typeof buildGraph>; pick(id: string): void }) {
  if (!props.ids.length) return null;
  return (
    <div class="map-links">
      <span class="small">{props.label} ({props.ids.length}):</span>{" "}
      {props.ids.map((id, i) => {
        const p = props.graph.nodes.get(id)!.paper;
        return (
          <span key={id}>
            {i ? "; " : ""}
            <a href="#" title={p.title} onClick={(e) => { e.preventDefault(); props.pick(id); }}>{nameOf(p)}</a>
          </span>
        );
      })}
    </div>
  );
}

function MissingList(props: { graph: ReturnType<typeof buildGraph>; papers: Paper[]; fetchKey?: string; onAdd(d: PaperDraft): boolean }) {
  const top = props.graph.missing.slice(0, 50);
  const [meta, setMeta] = useState<Map<string, PaperDraft & { cited?: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const ids = top.map((m) => m.oa).join(",");

  useEffect(() => {
    if (!top.length) return;
    worksById(top.map((m) => m.oa), { key: props.fetchKey }).then(setMeta, (e) => setError((e as Error).message));
  }, [ids]);

  if (!props.graph.known) return <p class="muted">Look up your papers' references first.</p>;
  if (!top.length) return <p class="muted">Nothing is cited by two or more of your papers without being in your library.</p>;
  const byId = new Map(props.papers.map((p) => [p.id, p]));
  return (
    <>
      <p class="muted">Works that several of your papers cite, which your library doesn't have yet. The most cited first.</p>
      {error && <p class="error">{error}</p>}
      <ul class="candidates">
        {top.map((m) => {
          const d = meta?.get(m.oa);
          return (
            <li key={m.oa} class="missing-item">
              <div>
                <div class="cand-title">{d?.title ?? (meta ? "Untitled work" : "…")}</div>
                {d && (
                  <div class="muted small">
                    {[shortAuthors(d.authors ?? []), d.year, d.venue].filter(Boolean).join(" · ")}
                    {d.cited !== undefined ? ` · cited ${d.cited} times` : ""}
                  </div>
                )}
                <div class="small">
                  <a href="#" onClick={(e) => { e.preventDefault(); setOpen(open === m.oa ? null : m.oa); }}>
                    Cited by {m.by.length} of your papers
                  </a>
                </div>
                {open === m.oa && (
                  <ul class="small cited-by">
                    {m.by.map((id) => <li key={id}>{byId.get(id)?.title}</li>)}
                  </ul>
                )}
              </div>
              <button
                class={added.has(m.oa) ? "" : "primary"}
                disabled={!d || added.has(m.oa)}
                onClick={() => {
                  if (d && props.onAdd(d)) setAdded(new Set([...added, m.oa]));
                }}
              >
                {added.has(m.oa) ? "Added" : "Add"}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
