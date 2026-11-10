import type { PaperDraft, StorageAdapter } from "./types";
import { type CitationStore, type FetchOptions } from "./citations";
import { workToDraft } from "./literature";

// Branches: grow the library through its citation network. Start from the
// whole library, a folder, or a few root papers, and walk one step out. Candidates are the works that cite a root,
// that a root cites, or that share many references with the roots; they are
// ranked by how tightly they tie to the roots (and to the rest of the
// library), not by popularity alone. Explorations are kept in
// lightkone/branches.json, with the works already seen, so opening one
// again shows what is new since. citations.json is left as it is.

export const EXPLORE_PATH = "lightkone/branches.json";
const API = "https://api.openalex.org/works";
const SELECT = "id,doi,title,publication_year,authorships,primary_location,cited_by_count,referenced_works,abstract_inverted_index";
/** How many citing works to read per run, most cited first. */
const CITING = 200;
/** How many of the roots' references to read. */
const CITED = 150;

export interface Root {
  /** OpenAlex id. */
  oa: string;
  title: string;
  /** The library paper, when it is one. */
  paperId?: string;
}

export interface Exploration {
  id: string;
  name: string;
  /**
   * What it grows from: "library" (all your papers), "folder:<name>", or
   * absent for the roots listed. A library or folder branch takes its roots
   * from the library each time, so papers added since count too.
   */
  scope?: string;
  roots: Root[];
  /** OpenAlex ids of candidates already shown. */
  seen: string[];
  /** ISO; when the exploration was first made. */
  made: string;
  /** ISO; when its results were last looked at. */
  looked?: string;
}

export interface ExploreStore {
  format: "lightkone-branches";
  version: 1;
  items: Exploration[];
}

const emptyStore = (): ExploreStore => ({ format: "lightkone-branches", version: 1, items: [] });
const decoder = new TextDecoder();

export async function loadExplorations(storage: StorageAdapter): Promise<ExploreStore> {
  const raw = await storage.read(EXPLORE_PATH).catch(() => null);
  if (!raw) return emptyStore();
  try {
    const s = JSON.parse(decoder.decode(raw)) as ExploreStore;
    return s.format === "lightkone-branches" && Array.isArray(s.items) ? s : emptyStore();
  } catch {
    return emptyStore();
  }
}

export const saveExplorations = (storage: StorageAdapter, s: ExploreStore) => storage.write(EXPLORE_PATH, JSON.stringify(s, null, 1), "application/json");

const shortId = (url: string) => String(url).slice(String(url).lastIndexOf("/") + 1);

export interface Candidate {
  oa: string;
  draft: PaperDraft;
  year: number;
  cited: number;
  refs: string[];
  /** Roots (OpenAlex ids) this work cites. */
  citesRoots: string[];
  /** Roots that cite this work. */
  citedByRoots: string[];
  /** References it shares with the roots. */
  shared: number;
  /** Library papers it cites or is cited by. */
  libraryLinks: string[];
  /** The library paper it is, if any. */
  paperId?: string;
  score: number;
}

export interface Neighbourhood {
  roots: (Root & { year: number; cited: number; refs: string[] })[];
  candidates: Candidate[];
  /** Grown from the library itself (all of it, or a folder). */
  library?: boolean;
  /** ISO; when it was read from OpenAlex. */
  at?: string;
}

async function getJson(url: string, o: FetchOptions): Promise<any> {
  const full = o.key ? `${url}&api_key=${encodeURIComponent(o.key)}` : url;
  const r = await (o.fetch ?? fetch)(full, { signal: o.signal });
  if (r.status === 429) throw new Error("OpenAlex's free daily budget for your network is used up. Add a free OpenAlex key under Settings → Related papers, or try again tomorrow.");
  if (!r.ok) throw new Error(`OpenAlex answered ${r.status}.`);
  return r.json();
}

async function byIds(ids: string[], o: FetchOptions): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await getJson(`${API}?filter=openalex:${batch.join("|")}&per-page=50&select=${SELECT}`, o);
    out.push(...(data.results ?? []));
  }
  return out;
}

/** The library's own papers by OpenAlex id, and what each cites, from the citation map's store. */
export function libraryIndex(store: CitationStore | null): { byOa: Map<string, string>; refs: Map<string, Set<string>> } {
  const byOa = new Map<string, string>();
  const refs = new Map<string, Set<string>>();
  for (const [id, w] of Object.entries(store?.works ?? {})) {
    if (!w.oa) continue;
    byOa.set(w.oa, id);
    refs.set(id, new Set(w.refs));
  }
  return { byOa, refs };
}

export interface ExploreOptions {
  /**
   * Growing the library itself (all of it, or a folder): roots are your own
   * papers, and only works tied to at least two of them are kept.
   */
  library?: boolean;
  onProgress?(done: number, total: number): void;
}

/** At most this many roots are asked about what cites them, 50 per request. */
const MAX_CITING_ROOTS = 1000;

/**
 * Walk one step out from the roots: the works that cite them (the most cited
 * first), the works they cite, and score each by its ties. Roots from the
 * library use the references already in citations.json; only the others are
 * fetched.
 */
export async function explore(roots: Root[], store: CitationStore | null, o: FetchOptions = {}, opts: ExploreOptions = {}): Promise<Neighbourhood> {
  const rootIds = roots.map((s) => s.oa);
  const rootSet = new Set(rootIds);
  const known = new Map<string, { year?: number; cited?: number; refs: string[] }>();
  for (const r of roots) {
    const w = r.paperId ? store?.works[r.paperId] : undefined;
    if (w?.oa === r.oa && w.year) known.set(r.oa, w);
  }
  const rootRows = await byIds(rootIds.filter((id) => !known.has(id)), o);
  const rootInfo = new Map<string, { title?: string; year?: number; cited?: number; refs: string[] }>(known);
  for (const x of rootRows) rootInfo.set(shortId(x.id), { title: x.title, year: x.publication_year ?? undefined, cited: x.cited_by_count ?? 0, refs: (x.referenced_works ?? []).map(shortId) });
  const rootRefs = new Map(rootIds.map((id) => [id, new Set<string>(rootInfo.get(id)?.refs ?? [])]));
  const allRootRefs = new Map<string, number>();
  for (const refs of rootRefs.values()) for (const r of refs) allRootRefs.set(r, (allRootRefs.get(r) ?? 0) + 1);

  // What cites the roots: one request for a few roots, 50 roots a request for many.
  const asking = [...rootIds].sort((a, b) => (rootInfo.get(b)?.cited ?? 0) - (rootInfo.get(a)?.cited ?? 0)).slice(0, MAX_CITING_ROOTS);
  const batches: string[][] = [];
  for (let i = 0; i < asking.length; i += 50) batches.push(asking.slice(i, i + 50));
  const perPage = batches.length > 1 ? 100 : CITING;
  const citing: any[] = [];
  const citingIds = new Set<string>();
  for (const [i, batch] of batches.entries()) {
    if (o.signal?.aborted) break;
    const rows = (await getJson(`${API}?filter=cites:${batch.join("|")}&sort=cited_by_count:desc&per-page=${perPage}&select=${SELECT}`, o)).results ?? [];
    for (const x of rows) {
      const id = shortId(x.id);
      if (citingIds.has(id)) continue;
      citingIds.add(id);
      citing.push(x);
    }
    opts.onProgress?.(i + 1, batches.length + 1);
  }
  // The references most of the roots share first, then the rest, as many as are read.
  const cited = [...allRootRefs]
    .filter(([id, n]) => !rootSet.has(id) && !citingIds.has(id) && (!opts.library || n >= 2))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, opts.library ? CITED * 2 : CITED)
    .map(([id]) => id);
  const citedRows = await byIds(cited, o);
  opts.onProgress?.(batches.length + 1, batches.length + 1);

  const lib = libraryIndex(store);
  const rootPapers = roots.map((s) => s.paperId).filter(Boolean) as string[];
  const candidates: Candidate[] = [];
  const done = new Set<string>();
  for (const x of [...citing, ...citedRows]) {
    const oa = shortId(x.id);
    if (rootSet.has(oa) || !x.title || done.has(oa)) continue;
    done.add(oa);
    const refs: string[] = (x.referenced_works ?? []).map(shortId);
    const refSet = new Set(refs);
    const citesRoots = rootIds.filter((s) => refSet.has(s));
    const citedByRoots = rootIds.filter((s) => rootRefs.get(s)!.has(oa));
    if (opts.library && citesRoots.length + citedByRoots.length < 2) continue;
    let shared = 0;
    for (const r of refs) if (allRootRefs.has(r)) shared++;
    const libraryLinks = new Set<string>();
    for (const r of refs) if (lib.byOa.has(r)) libraryLinks.add(lib.byOa.get(r)!);
    for (const [id, rs] of lib.refs) if (rs.has(oa)) libraryLinks.add(id);
    const paperId = lib.byOa.get(oa);
    if (paperId) libraryLinks.delete(paperId);
    for (const id of rootPapers) libraryLinks.delete(id);
    const cites = x.cited_by_count ?? 0;
    const score = 3 * (citesRoots.length + citedByRoots.length) + Math.min(12, shared) * 0.5 + Math.min(6, libraryLinks.size) + Math.log10(1 + cites) * 0.6;
    candidates.push({
      oa,
      draft: workToDraft(x),
      year: x.publication_year ?? 0,
      cited: cites,
      refs,
      citesRoots,
      citedByRoots,
      shared,
      libraryLinks: [...libraryLinks],
      paperId,
      score,
    });
  }
  candidates.sort((a, b) => b.score - a.score || b.cited - a.cited || a.oa.localeCompare(b.oa));
  return {
    roots: roots.map((s) => {
      const x = rootInfo.get(s.oa);
      return { ...s, title: x?.title ?? s.title, year: x?.year ?? 0, cited: x?.cited ?? 0, refs: [...(rootRefs.get(s.oa) ?? [])] };
    }),
    candidates,
    library: Boolean(opts.library),
    at: new Date().toISOString(),
  };
}

/** Why a candidate is here, in words. */
export function reasons(c: Candidate, rootCount: number, library = false): string[] {
  const out: string[] = [];
  const of = (n: number) => (library ? `${n} of your papers` : rootCount > 1 ? `${n} of the ${rootCount} roots` : "the root");
  if (c.citesRoots.length) out.push(`cites ${of(c.citesRoots.length)}`);
  if (c.citedByRoots.length) out.push(`cited by ${of(c.citedByRoots.length)}`);
  if (c.shared >= 2) out.push(`shares ${c.shared} references`);
  if (c.libraryLinks.length) out.push(`linked to ${c.libraryLinks.length} ${library ? "more" : "of your papers"}`);
  return out;
}

export interface ExploreFilter {
  from?: number;
  to?: number;
  text?: string;
  hideLibrary?: boolean;
  onlyNew?: boolean;
  sort?: "ties" | "cited" | "newest";
}

/** The candidates to show; with onlyNew, only those in fresh (new since last time). */
export function filterCandidates(cs: Candidate[], f: ExploreFilter, fresh: Set<string>): Candidate[] {
  const words = (f.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const out = cs.filter((c) => {
    if (f.from && c.year && c.year < f.from) return false;
    if (f.to && c.year && c.year > f.to) return false;
    if (f.hideLibrary && c.paperId) return false;
    if (f.onlyNew && !fresh.has(c.oa)) return false;
    if (words.length) {
      const hay = `${c.draft.title} ${(c.draft.authors ?? []).join(" ")} ${c.draft.venue ?? ""} ${c.draft.abstract ?? ""}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  if (f.sort === "cited") out.sort((a, b) => b.cited - a.cited);
  else if (f.sort === "newest") out.sort((a, b) => b.year - a.year || b.score - a.score);
  return out;
}

export interface Dot {
  id: string;
  year: number;
  cited: number;
  r: number;
}

export interface Spot extends Dot {
  x: number;
  y: number;
}

/**
 * Place dots on a year (across) by citations (up, on a log scale) plane,
 * nudging any that would overlap. The biggest are placed first.
 */
export function scatter(dots: Dot[], size: { width: number; height: number; years: [number, number]; pad?: number }): { spots: Spot[]; yOf(cited: number): number; xOf(year: number): number; top: number; low: number } {
  const pad = size.pad ?? 30;
  const [y0, y1] = size.years;
  const span = Math.max(1, y1 - y0);
  const xOf = (year: number) => 40 + ((year - y0) / span) * (size.width - 80);
  const top = Math.max(10, ...dots.map((d) => d.cited));
  // The axis starts at the decade below the least cited, so the dots fill the height.
  const least = dots.length ? Math.min(...dots.map((d) => d.cited)) : 0;
  const low = least < 10 ? 0 : 10 ** Math.floor(Math.log10(least));
  const lmin = Math.log10(1 + low);
  const lmax = Math.max(lmin + 1, Math.log10(1 + top));
  const yOf = (cited: number) => size.height - pad - ((Math.log10(1 + cited) - lmin) / (lmax - lmin)) * (size.height - 2 * pad);
  const spots: Spot[] = [];
  for (const d of [...dots].sort((a, b) => b.r - a.r || a.id.localeCompare(b.id))) {
    const x = xOf(d.year || y0);
    const want = yOf(d.cited);
    const free = (y: number) => spots.every((q) => Math.hypot(q.x - x, q.y - y) >= q.r + d.r + 1.5);
    let y = want;
    for (let k = 1; !free(y) && k < 120; k++) y = want + Math.ceil(k / 2) * (d.r + 1) * (k % 2 ? -1 : 1);
    spots.push({ ...d, x, y: Math.min(size.height - pad + 12, Math.max(pad - 12, y)) });
  }
  return { spots, yOf, xOf, top, low };
}

/** A name for a new exploration from its roots. */
export function nameFor(roots: Root[]): string {
  if (!roots.length) return "Exploration";
  const first = roots[0].title.length > 48 ? `${roots[0].title.slice(0, 46).trim()}…` : roots[0].title;
  return roots.length > 1 ? `${first} + ${roots.length - 1}` : first;
}

// A branch's last result is kept in storage, so opening it again shows it at
// once instead of asking OpenAlex again: lightkone/branches/<key>.json.
// Library roots keep no references there; they come back from citations.json.

export const RESULTS_DIR = "lightkone/branches/";
/** A kept result older than this is refreshed when the branch is opened. */
export const RESULT_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

interface ResultFile {
  format: "lightkone-branch-result";
  version: 1;
  at: string;
  scope: string;
  roots: (Root & { year: number; cited: number; refs?: string[] })[];
  candidates: Candidate[];
  library: boolean;
}

/** A short stable hash, for naming a picked set of roots. */
function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** Where a branch's result is kept: by its scope, or by its roots when they were picked. */
export function resultPath(scope: string, roots: Root[]): string {
  if (scope === "library") return `${RESULTS_DIR}library.json`;
  if (scope.startsWith("folder:")) return `${RESULTS_DIR}folder-${scope.slice(7).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${hash(scope)}.json`;
  return `${RESULTS_DIR}roots-${hash(roots.map((r) => r.oa).sort().join("|"))}.json`;
}

export async function saveResult(storage: StorageAdapter, path: string, scope: string, r: Neighbourhood): Promise<void> {
  const file: ResultFile = {
    format: "lightkone-branch-result",
    version: 1,
    at: r.at ?? new Date().toISOString(),
    scope,
    // Your own papers' references are in citations.json already.
    roots: r.roots.map(({ refs, ...rest }) => (rest.paperId ? rest : { ...rest, refs })),
    candidates: r.candidates,
    library: Boolean(r.library),
  };
  await storage.write(path, JSON.stringify(file), "application/json");
}

export async function loadResult(storage: StorageAdapter, path: string, store: CitationStore | null): Promise<Neighbourhood | null> {
  const raw = await storage.read(path).catch(() => null);
  if (!raw) return null;
  try {
    const f = JSON.parse(decoder.decode(raw)) as ResultFile;
    if (f.format !== "lightkone-branch-result" || !Array.isArray(f.candidates)) return null;
    return {
      at: f.at,
      library: f.library,
      candidates: f.candidates,
      roots: f.roots.map((r) => ({ ...r, refs: r.refs ?? (r.paperId ? store?.works[r.paperId]?.refs ?? [] : []) })),
    };
  } catch {
    return null;
  }
}
