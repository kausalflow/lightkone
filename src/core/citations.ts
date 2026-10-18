import type { Paper, PaperDraft, StorageAdapter } from "./types";

// The citation map: which papers in the library cite which, and the works
// many of them cite that the library does not have. After kirsche
// (github.com/kausalflow/kirsche), which connected papers by their reference
// lists and drew them by year. References come from OpenAlex, called from
// the browser; what was fetched is kept in lightkone/citations.json so each
// paper is looked up once.

export const CITATIONS_PATH = "lightkone/citations.json";
const API = "https://api.openalex.org/works";
const BATCH = 50;
/** Papers OpenAlex did not know are asked about again after this long. */
const RETRY_MS = 30 * 24 * 3600 * 1000;

export interface Work {
  /** OpenAlex id, like W2741809807; null when OpenAlex has no such work. */
  oa: string | null;
  year?: number;
  cited?: number;
  refs: string[];
  /** When it was fetched, ISO. */
  at: string;
}

export interface CitationStore {
  format: "lightkone-citations";
  version: 1;
  /** By paper id. */
  works: Record<string, Work>;
}

export const emptyStore = (): CitationStore => ({ format: "lightkone-citations", version: 1, works: {} });

const decoder = new TextDecoder();

export async function loadCitations(storage: StorageAdapter): Promise<CitationStore> {
  const raw = await storage.read(CITATIONS_PATH).catch(() => null);
  if (!raw) return emptyStore();
  try {
    const s = JSON.parse(decoder.decode(raw)) as CitationStore;
    return s.format === "lightkone-citations" ? s : emptyStore();
  } catch {
    return emptyStore();
  }
}

export const saveCitations = (storage: StorageAdapter, s: CitationStore) => storage.write(CITATIONS_PATH, JSON.stringify(s), "application/json");

const shortId = (url: string) => url.slice(url.lastIndexOf("/") + 1);

/** The DOI OpenAlex files a paper under: its own, or arXiv's for a preprint. */
export function doiOf(p: Paper): string | null {
  if (p.doi) return p.doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
  if (p.arxiv) return `10.48550/arxiv.${p.arxiv.toLowerCase().replace(/^arxiv:/, "").replace(/v\d+$/, "")}`;
  return null;
}

/** Papers to look up: never fetched, or not found a while ago. */
export function needsFetch(papers: Paper[], s: CitationStore, now = Date.now()): Paper[] {
  return papers.filter((p) => {
    if (p.trashed || !doiOf(p)) return false;
    const w = s.works[p.id];
    return !w || (!w.oa && now - Date.parse(w.at) > RETRY_MS);
  });
}

export interface FetchOptions {
  /** An OpenAlex API key, for a daily budget of one's own. */
  key?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

const withKey = (url: string, key?: string) => (key ? `${url}&api_key=${encodeURIComponent(key)}` : url);

async function getJson(url: string, o: FetchOptions): Promise<any> {
  const r = await (o.fetch ?? fetch)(withKey(url, o.key), { signal: o.signal });
  if (r.status === 429) throw new Error("OpenAlex's free daily budget for your network is used up. Add a free OpenAlex key under Settings → Related papers, or try again tomorrow.");
  if (!r.ok) throw new Error(`OpenAlex answered ${r.status}.`);
  return r.json();
}

/** Fetch references for papers not yet in the store, 50 at a time. Returns how many were found. */
export async function fetchCitations(papers: Paper[], s: CitationStore, o: FetchOptions, onProgress?: (done: number, total: number) => void): Promise<number> {
  const todo = needsFetch(papers, s);
  let found = 0;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (o.signal?.aborted) break;
    const batch = todo.slice(i, i + BATCH);
    const byDoi = new Map(batch.map((p) => [doiOf(p)!, p]));
    const filter = [...byDoi.keys()].map((d) => d.replace(/[|,]/g, "")).join("|");
    const data = await getJson(`${API}?filter=doi:${encodeURIComponent(filter)}&per-page=${BATCH}&select=id,doi,publication_year,cited_by_count,referenced_works`, o);
    const at = new Date().toISOString();
    for (const p of batch) s.works[p.id] = { oa: null, refs: [], at };
    for (const w of data.results ?? []) {
      const p = byDoi.get(String(w.doi ?? "").toLowerCase().replace(/^https:\/\/doi\.org\//, ""));
      if (!p) continue;
      s.works[p.id] = { oa: shortId(w.id), year: w.publication_year ?? undefined, cited: w.cited_by_count ?? 0, refs: (w.referenced_works ?? []).map(shortId), at };
      found++;
    }
    onProgress?.(Math.min(i + BATCH, todo.length), todo.length);
  }
  return found;
}

export interface Node {
  paper: Paper;
  year: number;
  cited: number;
  /** Library papers this one cites. */
  cites: string[];
  /** Library papers that cite this one. */
  citedBy: string[];
}

export interface Missing {
  oa: string;
  /** Library papers citing it. */
  by: string[];
}

export interface Graph {
  nodes: Map<string, Node>;
  edges: [from: string, to: string][];
  /** Works cited by several library papers that are not in the library, most cited first. */
  missing: Missing[];
  /** Papers that have references from OpenAlex. */
  known: number;
}

export function buildGraph(papers: Paper[], s: CitationStore, minMissing = 2): Graph {
  const live = papers.filter((p) => !p.trashed);
  const byOa = new Map<string, string>();
  for (const p of live) {
    const w = s.works[p.id];
    if (w?.oa) byOa.set(w.oa, p.id);
  }
  const nodes = new Map<string, Node>();
  for (const p of live) {
    const w = s.works[p.id];
    nodes.set(p.id, { paper: p, year: p.year ?? w?.year ?? 0, cited: w?.cited ?? 0, cites: [], citedBy: [] });
  }
  const edges: [string, string][] = [];
  const counts = new Map<string, Set<string>>();
  let known = 0;
  for (const p of live) {
    const w = s.works[p.id];
    if (!w?.oa) continue;
    known++;
    for (const r of new Set(w.refs)) {
      const target = byOa.get(r);
      if (target && target !== p.id) {
        edges.push([p.id, target]);
        nodes.get(p.id)!.cites.push(target);
        nodes.get(target)!.citedBy.push(p.id);
      } else if (!target) {
        if (!counts.has(r)) counts.set(r, new Set());
        counts.get(r)!.add(p.id);
      }
    }
  }
  const missing = [...counts]
    .filter(([, by]) => by.size >= minMissing)
    .map(([oa, by]) => ({ oa, by: [...by] }))
    .sort((a, b) => b.by.length - a.by.length || a.oa.localeCompare(b.oa));
  return { nodes, edges, missing, known };
}

const flip = (name: string) => {
  const parts = String(name).trim().split(" ");
  return parts.length > 1 ? `${parts.pop()}, ${parts.join(" ")}` : name;
};

/** Records for works by OpenAlex id, to show and add. */
export async function worksById(ids: string[], o: FetchOptions): Promise<Map<string, PaperDraft & { cited?: number }>> {
  const out = new Map<string, PaperDraft & { cited?: number }>();
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const data = await getJson(`${API}?filter=openalex:${batch.join("|")}&per-page=${BATCH}&select=id,doi,title,publication_year,authorships,primary_location,cited_by_count`, o);
    for (const x of data.results ?? []) {
      if (!x.title) continue;
      const doi = x.doi?.replace(/^https:\/\/doi\.org\//, "");
      const arxiv = doi?.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
      out.set(shortId(x.id), {
        type: "article",
        title: x.title,
        authors: (x.authorships ?? []).map((a: any) => flip(a.author?.display_name ?? "")).filter(Boolean),
        year: x.publication_year ?? undefined,
        venue: x.primary_location?.source?.display_name ?? undefined,
        doi: arxiv ? undefined : doi,
        arxiv,
        cited: x.cited_by_count ?? undefined,
        fields: {},
      });
    }
  }
  return out;
}

export interface Placed {
  id: string;
  x: number;
  y: number;
  r: number;
  band: number;
}

/**
 * Positions on a year axis, in one horizontal band per group (as in kirsche's
 * figures), higher in the band the more the paper is cited. The most
 * connected papers are placed first; the rest move aside so none overlap.
 */
export function layout(g: Graph, ids: string[], bandOf: (p: Paper) => number, bands: number, size: { width: number; bandHeight: number; years: [number, number] }): Placed[] {
  const [y0, y1] = size.years;
  const span = Math.max(1, y1 - y0);
  const xOf = (year: number) => 40 + ((year - y0) / span) * (size.width - 80);
  const degree = (id: string) => g.nodes.get(id)!.cites.length + g.nodes.get(id)!.citedBy.length;
  const order = [...ids].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b));
  // Within a band, height says how often a paper is cited, as kirsche's charts did.
  const most = Math.max(1, ...ids.map((id) => Math.log1p(g.nodes.get(id)!.cited)));
  const placed = new Map<string, Placed>();
  const perBand: Placed[][] = Array.from({ length: bands }, () => []);
  for (const id of order) {
    const n = g.nodes.get(id)!;
    const band = Math.min(bands - 1, bandOf(n.paper));
    const r = 3 + Math.min(9, 1.6 * Math.log1p(n.cited));
    const x = xOf(n.year || y0);
    const top = band * size.bandHeight + r + 4;
    const bottom = (band + 1) * size.bandHeight - r - 4;
    const want = bottom - (Math.log1p(n.cited) / most) * (bottom - top);
    const free = (y: number) => perBand[band].every((q) => Math.hypot(q.x - x, q.y - y) >= q.r + r + 2);
    let y = Math.min(bottom, Math.max(top, want));
    for (let k = 1; !free(y) && k < 200; k++) {
      const step = Math.ceil(k / 2) * (r + 1) * (k % 2 ? 1 : -1);
      const c = want + step;
      if (c >= top && c <= bottom && free(c)) {
        y = c;
        break;
      }
    }
    const p = { id, x, y: Math.min(bottom, Math.max(top, y)), r, band };
    placed.set(id, p);
    perBand[band].push(p);
  }
  return [...placed.values()];
}
