import type { Paper, PaperDraft } from "./types";
import { normArxiv, normDoi } from "./library";

// How others cite this: the sentences in later papers that cite a paper, from
// Semantic Scholar's citation contexts, so you can see whether the field took
// it up, built on it, or argued with it. Claude can sort them into supporting,
// contrasting and mentioning.

export type Intent = "background" | "methodology" | "result";
export type Stance = "supports" | "contrasts" | "mentions";

export interface Citing {
  /** Semantic Scholar's paper id. */
  id: string;
  title: string;
  /** "Last, First" strings. */
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxiv?: string;
  /** How often the citing paper is itself cited. */
  cited?: number;
  /** The sentences in it that cite the paper. */
  contexts: string[];
  intents: Intent[];
  /** Semantic Scholar's mark for a citation that builds on the paper substantially. */
  influential: boolean;
}

export interface Citations {
  /** Every citing paper Semantic Scholar returned, those with sentences first. */
  items: Citing[];
  /** How many cite it in all, when Semantic Scholar says. */
  total?: number;
}

const API = "https://api.semanticscholar.org/graph/v1/paper";
const FIELDS = "contexts,intents,isInfluential,title,year,authors,externalIds,venue,citationCount";

const flip = (name: string) => {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts.pop()}, ${parts.join(" ")}` : name;
};

/** The id Semantic Scholar knows a paper by: its journal DOI, else its arXiv id. */
export function s2Id(p: Pick<Paper, "doi" | "arxiv">): string | null {
  const doi = normDoi(p.doi);
  if (doi && !/^10\.48550\//.test(doi)) return `DOI:${doi}`;
  const arxiv = normArxiv(p.arxiv) ?? doi?.match(/^10\.48550\/arxiv\.(.+)$/)?.[1];
  return arxiv ? `arXiv:${arxiv}` : null;
}

/** One row of Semantic Scholar's citations list, as a citing paper. */
export function citingOf(row: any): Citing | null {
  const c = row?.citingPaper;
  if (!c?.paperId || !c.title) return null;
  const doi = c.externalIds?.DOI && !/^10\.48550/i.test(c.externalIds.DOI) ? String(c.externalIds.DOI) : undefined;
  const intents = (row.intents ?? []).filter((i: string) => ["background", "methodology", "result"].includes(i)) as Intent[];
  const contexts = [...new Set((row.contexts ?? []).map((s: string) => String(s).replace(/\(cid:\d+\)/g, " ").replace(/\s+/g, " ").trim()).filter((s: string) => s.length > 20))] as string[];
  return {
    id: c.paperId,
    title: String(c.title),
    authors: (c.authors ?? []).map((a: any) => flip(a.name ?? "")).filter(Boolean),
    year: c.year ?? undefined,
    venue: c.venue || undefined,
    doi,
    arxiv: c.externalIds?.ArXiv || undefined,
    cited: typeof c.citationCount === "number" ? c.citationCount : undefined,
    contexts,
    intents,
    influential: Boolean(row.isInfluential),
  };
}

/** Citing papers with sentences first, the influential and much-cited ones before the rest, then the newest. */
export function rank(items: Citing[]): Citing[] {
  const score = (c: Citing) => (c.contexts.length ? 1e9 : 0) + (c.influential ? 1e8 : 0) + Math.min(c.cited ?? 0, 1e7);
  return [...items].sort((a, b) => score(b) - score(a) || (b.year ?? 0) - (a.year ?? 0));
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const BUSY = "Semantic Scholar is busy for everyone without a key just now. Try again in a minute, or add a free key under Settings → Related papers.";

/**
 * A request to Semantic Scholar, tried again after a pause when it is over its
 * limit. Its 429 answers carry no CORS header, so a browser sees them as a
 * failed fetch rather than a status; both count as busy.
 */
async function polite(f: Fetch, url: string, init: RequestInit, waits: number[]): Promise<Response> {
  for (let i = 0; ; i++) {
    let r: Response | null = null;
    try {
      r = await f(url, init);
    } catch (e) {
      if (init.signal?.aborted) throw e;
    }
    if (r && r.status !== 429) return r;
    if (i >= waits.length) throw new Error(BUSY);
    await new Promise((ok) => setTimeout(ok, waits[i]));
  }
}

/**
 * The papers citing a paper, with the sentences that cite it. Semantic Scholar
 * gives up to 1000 at a time; `max` caps how many are read in all.
 */
export async function fetchCitations(p: Pick<Paper, "doi" | "arxiv">, o: { key?: string; fetch?: Fetch; signal?: AbortSignal; max?: number; waits?: number[] } = {}): Promise<Citations> {
  const id = s2Id(p);
  if (!id) throw new Error("This paper has no DOI or arXiv id to look it up by.");
  const f = o.fetch ?? ((u: string, init?: RequestInit) => fetch(u, init));
  const max = o.max ?? 1000;
  const items: Citing[] = [];
  const headers = o.key ? { "x-api-key": o.key } : undefined;
  for (let offset = 0; offset < max; ) {
    const limit = Math.min(1000, max - offset);
    let r: Response;
    try {
      r = await polite(f, `${API}/${encodeURIComponent(id)}/citations?fields=${FIELDS}&limit=${limit}&offset=${offset}`, { signal: o.signal, headers }, o.waits ?? [1500, 4000]);
    } catch (e) {
      if (items.length && !o.signal?.aborted) break;
      throw e;
    }
    if (r.status === 404) {
      if (offset === 0) throw new Error("Semantic Scholar doesn't know this paper.");
      break;
    }
    if (!r.ok) throw new Error(`Semantic Scholar answered ${r.status}. Try again in a minute.`);
    const data = await r.json();
    for (const row of data.data ?? []) {
      const c = citingOf(row);
      if (c) items.push(c);
    }
    if (typeof data.next !== "number") break;
    offset = data.next;
  }
  // How many cite it in all, asked after the list so the two don't race Semantic Scholar's limit.
  const total = await polite(f, `${API}/${encodeURIComponent(id)}?fields=citationCount`, { signal: o.signal, headers }, o.waits ?? [1500])
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (typeof d?.citationCount === "number" ? (d.citationCount as number) : undefined))
    .catch(() => undefined);
  return { items: rank(items), total };
}

/** A citing paper as a draft to add to the library. */
export function draftOf(c: Citing): PaperDraft {
  return {
    type: "article",
    title: c.title,
    authors: c.authors,
    year: c.year,
    venue: c.venue,
    doi: c.doi,
    arxiv: c.arxiv,
    url: c.arxiv ? `https://arxiv.org/abs/${c.arxiv}` : undefined,
    fields: {},
  };
}

/** The library's copy of a citing paper, by DOI, arXiv id or title. */
export function inLibraryOf(c: Citing, papers: Paper[]): Paper | undefined {
  const title = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const doi = normDoi(c.doi);
  const arxiv = normArxiv(c.arxiv);
  const t = title(c.title);
  return papers.find((p) => !p.trashed && ((doi && normDoi(p.doi) === doi) || (arxiv && normArxiv(p.arxiv) === arxiv) || title(p.title) === t));
}

/** The citing sentences to send Claude, numbered: one entry per citing paper, its sentences joined. */
export function stancePrompt(items: Citing[]): string {
  return items
    .map((c, i) => `<citation n="${i + 1}" paper="${c.title.replace(/"/g, "'")}"${c.year ? ` year="${c.year}"` : ""}>\n${c.contexts.join("\n…\n")}\n</citation>`)
    .join("\n\n");
}

export interface StanceVerdict {
  n: number;
  stance: Stance;
  /** A few words on what the citing paper does with it. */
  note?: string;
}

/** Claude's stances, from a JSON array in its reply. */
export function parseStances(text: string): StanceVerdict[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try {
    return (JSON.parse(text.slice(start, end + 1)) as Partial<StanceVerdict>[])
      .filter((v) => typeof v.n === "number" && ["supports", "contrasts", "mentions"].includes(v.stance as string))
      .map((v) => ({ n: v.n!, stance: v.stance!, note: typeof v.note === "string" && v.note.trim() ? v.note.trim() : undefined }));
  } catch {
    return [];
  }
}
