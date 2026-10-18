import type { Paper, PaperDraft, StorageAdapter } from "./types";
import { terms } from "./ask";

// New on arXiv for you: each day's preprints in the categories you read,
// ranked by how close each is to papers already in your library, after
// swarm-notes (leima.is/swarm-notes-ts), which tracks arXiv by keywords.
// What you set and what you turned down is kept in lightkone/new-on-arxiv.json,
// so every device shows the same list and "Not for me" teaches it.

export const FRESH_PATH = "lightkone/new-on-arxiv.json";
const KEEP_DISMISSED = 300;

export interface Preprint {
  arxiv: string;
  title: string;
  abstract: string;
  authors: string[];
  /** First version, ISO. */
  published: string;
  /** Primary category first. */
  categories: string[];
}

export interface FreshStore {
  format: "lightkone-new-on-arxiv";
  version: 1;
  /** arXiv categories to follow, like astro-ph.CO. Empty: guessed from the library. */
  categories: string[];
  /** Words or phrases that lift a preprint, like swarm-notes' keywords. */
  keywords: string[];
  /** Preprints turned down, newest first, with enough text to learn from. */
  dismissed: { arxiv: string; title: string; abstract?: string; at: string }[];
  /** When the list was last opened, ISO; later preprints are marked new. */
  visited?: string;
}

export const emptyFresh = (): FreshStore => ({ format: "lightkone-new-on-arxiv", version: 1, categories: [], keywords: [], dismissed: [] });

const decoder = new TextDecoder();

export async function loadFresh(storage: StorageAdapter): Promise<FreshStore> {
  const raw = await storage.read(FRESH_PATH).catch(() => null);
  if (!raw) return emptyFresh();
  try {
    const s = JSON.parse(decoder.decode(raw)) as FreshStore;
    return s.format === "lightkone-new-on-arxiv" ? { ...emptyFresh(), ...s } : emptyFresh();
  } catch {
    return emptyFresh();
  }
}

export const saveFresh = (storage: StorageAdapter, s: FreshStore) => storage.write(FRESH_PATH, JSON.stringify(s), "application/json");

/** Remember a preprint as not for me. */
export function dismiss(s: FreshStore, p: Preprint, now = new Date()): FreshStore {
  const rest = s.dismissed.filter((d) => d.arxiv !== p.arxiv);
  return { ...s, dismissed: [{ arxiv: p.arxiv, title: p.title, abstract: p.abstract.slice(0, 800), at: now.toISOString() }, ...rest].slice(0, KEEP_DISMISSED) };
}

const bare = (id: string) => id.toLowerCase().replace(/^arxiv:/, "").replace(/v\d+$/, "");

/** The categories most of the library's arXiv papers are filed under. */
export function topCategories(records: Preprint[], n = 4): string[] {
  const count = new Map<string, number>();
  for (const r of records) {
    const c = r.categories[0];
    if (c) count.set(c, (count.get(c) ?? 0) + 1);
  }
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([c]) => c);
}

/** arXiv ids of the library's newest papers, to guess its categories from. */
export function profileIds(papers: Paper[], max = 200): string[] {
  return papers
    .filter((p) => p.arxiv && !p.trashed)
    .sort((a, b) => (b.added ?? "").localeCompare(a.added ?? ""))
    .slice(0, max)
    .map((p) => bare(p.arxiv!));
}

/** Words stripped of a plural s, so "networks" meets "network". */
const words = (text: string) => [...new Set(terms(text).map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)))];

// A paper's words are worked out once per session and again only when its title or abstract changes.
const known = new Map<string, { text: string; w: string[] }>();
function paperWords(p: Paper): string[] {
  const text = `${p.title} ${p.title} ${p.abstract ?? ""}`;
  const hit = known.get(p.id);
  if (hit?.text === text) return hit.w;
  const w = words(text);
  known.set(p.id, { text, w });
  return w;
}

export interface Pick {
  preprint: Preprint;
  score: number;
  /** Library papers it is closest to, closest first. */
  near: string[];
  /** Keywords it mentions. */
  keywords: string[];
  /** Published after the last visit. */
  fresh: boolean;
}

/**
 * Preprints ranked by how much they share, word by rare word, with the papers
 * closest to them in the library. Keywords lift a preprint; resemblance to
 * ones turned down lowers it. Papers already in the library are left out.
 */
export function rank(preprints: Preprint[], papers: Paper[], s: FreshStore): Pick[] {
  const live = papers.filter((p) => !p.trashed);
  const have = new Set(live.flatMap((p) => (p.arxiv ? [bare(p.arxiv)] : [])));
  const titles = new Set(live.map((p) => p.title.toLowerCase().replace(/\W+/g, "")));
  const turnedDown = new Set(s.dismissed.map((d) => d.arxiv));
  const todo = preprints.filter((p) => !have.has(bare(p.arxiv)) && !turnedDown.has(p.arxiv) && !titles.has(p.title.toLowerCase().replace(/\W+/g, "")));

  const libDocs = live.map((p) => ({ id: p.id, w: paperWords(p) })).filter((d) => d.w.length);
  const noDocs = s.dismissed.map((d) => words(`${d.title} ${d.abstract ?? ""}`));
  const newDocs = todo.map((p) => words(`${p.title} ${p.abstract}`));

  const df = new Map<string, number>();
  for (const d of [...libDocs.map((d) => d.w), ...newDocs]) for (const w of d) df.set(w, (df.get(w) ?? 0) + 1);
  const total = libDocs.length + newDocs.length;
  // Each word's weight, idf squared, worked out once.
  const weight = new Map<string, number>();
  for (const [w, n] of df) weight.set(w, Math.log((total + 1) / (n + 1)) ** 2);
  const wt = (w: string) => weight.get(w) ?? Math.log(total + 1) ** 2;
  const norm = (ws: string[]) => Math.sqrt(ws.reduce((t, w) => t + wt(w), 0)) || 1;

  // Which library papers hold each word.
  const postings = new Map<string, number[]>();
  libDocs.forEach((d, i) => d.w.forEach((w) => (postings.get(w) ?? postings.set(w, []).get(w)!).push(i)));
  const libNorm = libDocs.map((d) => norm(d.w));
  const noSets = noDocs.map((ws) => ({ ws: new Set(ws), n: norm(ws) }));
  const keywords = s.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  const visited = s.visited ? Date.parse(s.visited) : NaN;

  return todo
    .map((p, i) => {
      const ws = newDocs[i];
      const n = norm(ws);
      const dot = new Float64Array(libDocs.length);
      for (const w of ws) {
        const x = wt(w);
        for (const j of postings.get(w) ?? []) dot[j] += x;
      }
      // The three closest, without sorting them all.
      const sims: { j: number; sim: number }[] = [];
      for (let j = 0; j < dot.length; j++) {
        if (!dot[j]) continue;
        const sim = dot[j] / (n * libNorm[j]);
        if (sims.length < 3 || sim > sims[2].sim) {
          sims.push({ j, sim });
          sims.sort((a, b) => b.sim - a.sim);
          if (sims.length > 3) sims.pop();
        }
      }
      const top = sims[0]?.sim ?? 0;
      const mean = sims.reduce((t, x) => t + x.sim, 0) / 3;
      let score = 0.6 * top + 0.4 * mean;
      const text = `${p.title} ${p.abstract}`.toLowerCase();
      const hits = keywords.filter((k) => text.includes(k));
      score += 0.25 * hits.length;
      let unlike = 0;
      for (const d of noSets) {
        let v = 0;
        for (const w of ws) if (d.ws.has(w)) v += wt(w);
        unlike = Math.max(unlike, v / (n * d.n));
      }
      score -= 0.5 * unlike;
      return {
        preprint: p,
        score,
        near: sims.filter((x) => x.sim > 0.05).map((x) => libDocs[x.j].id),
        keywords: hits,
        fresh: Number.isFinite(visited) && Date.parse(p.published) > visited,
      };
    })
    .sort((a, b) => b.score - a.score || b.preprint.published.localeCompare(a.preprint.published));
}

/** The best picks of the last `days` days, grouped by the day they appeared, newest day first. */
export function digest(picks: Pick[], opts: { days?: number; max?: number; now?: Date } = {}): { day: string; picks: Pick[] }[] {
  const { days = 3, max = 20, now = new Date() } = opts;
  const days0 = new Set(picks.map((p) => p.preprint.published.slice(0, 10)).filter(Boolean));
  // The last few days arXiv announced on, not calendar days, so weekends don't empty it.
  const recent = [...days0].sort().reverse().slice(0, days);
  const cutoff = new Date(now.getTime() - 14 * 86400e3).toISOString().slice(0, 10);
  const chosen = picks.filter((p) => recent.includes(p.preprint.published.slice(0, 10)) && p.preprint.published.slice(0, 10) >= cutoff).slice(0, max);
  return recent
    .map((day) => ({ day, picks: chosen.filter((p) => p.preprint.published.startsWith(day)) }))
    .filter((g) => g.picks.length);
}

/** The preprint as a library entry. */
export function toDraft(p: Preprint): PaperDraft {
  return {
    type: "article",
    title: p.title,
    authors: p.authors,
    year: Number(p.published.slice(0, 4)) || undefined,
    abstract: p.abstract,
    arxiv: p.arxiv,
    url: `https://arxiv.org/abs/${p.arxiv}`,
    fields: { eprinttype: "arxiv", eprint: p.arxiv, ...(p.categories[0] ? { primaryclass: p.categories[0] } : {}) },
  };
}

/** Ask the /api/arxiv pass-through. */
export async function getPreprints(query: { cats?: string[]; ids?: string[] }, f: typeof fetch = fetch, signal?: AbortSignal): Promise<Preprint[]> {
  const q = query.ids?.length ? `ids=${query.ids.join(",")}` : `cats=${(query.cats ?? []).join(",")}`;
  const r = await f(`api/arxiv?${q}`, { signal });
  if (!r.ok) {
    const msg = await r.json().then((b: any) => b?.error, () => null);
    throw new Error(msg || `arXiv could not be reached (${r.status}).`);
  }
  return r.json();
}
