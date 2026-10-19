import type { Paper } from "./types";

// Plain-text search over the fields people remember. Every word must match
// somewhere; title and author hits rank higher. Supports filters:
//   tag:"machine learning"  author:hinton  year:2019  year:2015-2020  has:pdf  has:abstract
//   in:"Physics/QFT" (that folder and the ones inside it)  is:starred  is:recent  is:trash
//   no:pdf (no PDF in this library's storage yet)  no:abstract  no:arxiv  no:notes
// Papers in the trash only show with is:trash. Words also match inside a
// paper's full text when one is given, ranked below matches in its record.

export interface Query {
  words: string[];
  tags: string[];
  authors: string[];
  years?: [number, number];
  has: string[];
  /** The opposite of has:, except that no:pdf ignores a file path from another manager. */
  no: string[];
  folders: string[];
  is: string[];
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function parseQuery(input: string): Query {
  const q: Query = { words: [], tags: [], authors: [], has: [], no: [], folders: [], is: [] };
  const re = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)/g;
  for (const m of input.matchAll(re)) {
    const field = (m[1] ?? m[3])?.toLowerCase();
    const value = m[2] ?? m[4];
    if (field === "tag") q.tags.push(fold(value));
    else if (field === "author") q.authors.push(fold(value));
    else if (field === "has") q.has.push(value.toLowerCase());
    else if (field === "no") q.no.push(value.toLowerCase());
    else if (field === "in") q.folders.push(fold(value).replace(/\/+$/, ""));
    else if (field === "is") q.is.push(value.toLowerCase());
    else if (field === "year") {
      const [a, b] = value.split("-").map(Number);
      if (a) q.years = [a, b || a];
    } else q.words.push(fold(m[5] ?? m[6] ?? m[0]));
  }
  return q;
}

const inFolder = (p: Paper, f: string) => (p.folders ?? []).some((pf) => {
  const x = fold(pf);
  return x === f || x.startsWith(`${f}/`);
});

/** Whether a paper's full text holds all the words (see textsearch.ts). */
export type InText = (paperId: string, words: string[]) => boolean;

function score(p: Paper, q: Query, inText?: InText): number {
  if (Boolean(p.trashed) !== q.is.includes("trash")) return 0;
  if (q.is.includes("starred") && !p.starred) return 0;
  if (q.is.includes("recent") && !p.opened) return 0;
  if (q.folders.length && !q.folders.every((f) => inFolder(p, f))) return 0;
  if (q.tags.length && !q.tags.every((t) => p.tags.some((pt) => fold(pt) === t))) return 0;
  const authorText = fold(p.authors.join(" ; "));
  if (q.authors.length && !q.authors.every((a) => authorText.includes(a))) return 0;
  if (q.years && (!p.year || p.year < q.years[0] || p.year > q.years[1])) return 0;
  for (const h of q.has) {
    if (h === "pdf" && !p.pdf && !p.file) return 0;
    if (h === "abstract" && !p.abstract) return 0;
    if (h === "arxiv" && !p.arxiv) return 0;
    if (h === "notes" && !p.notes) return 0;
  }
  for (const n of q.no) {
    if (n === "pdf" && p.pdf) return 0;
    if (n === "abstract" && p.abstract) return 0;
    if (n === "arxiv" && p.arxiv) return 0;
    if (n === "notes" && p.notes) return 0;
  }
  if (!q.words.length) return 1;
  const title = fold(p.title);
  const rest = fold([p.abstract, p.venue, p.tags.join(" "), p.key, p.doi, p.arxiv, p.notes].filter(Boolean).join(" "));
  let total = 0;
  for (const w of q.words) {
    const s = (title.includes(w) ? 5 : 0) + (authorText.includes(w) ? 4 : 0) + (rest.includes(w) ? 1 : 0);
    if (!s) return inText?.(p.id, q.words) ? 0.5 : 0;
    total += s;
  }
  return total;
}

export type SortBy = "added" | "year" | "title" | "relevance" | "opened";

export function search(papers: Paper[], input: string, sort: SortBy = "added", inText?: InText): Paper[] {
  const q = parseQuery(input);
  const scored = papers.map((p) => [p, score(p, q, inText)] as const).filter(([, s]) => s > 0);
  const by: Record<SortBy, (a: Paper, b: Paper, sa: number, sb: number) => number> = {
    relevance: (a, b, sa, sb) => sb - sa || b.added.localeCompare(a.added),
    added: (a, b) => b.added.localeCompare(a.added),
    year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
    title: (a, b) => a.title.localeCompare(b.title),
    opened: (a, b) => (b.opened ?? "").localeCompare(a.opened ?? "") || b.added.localeCompare(a.added),
  };
  const effective = sort === "added" && q.is.includes("recent") ? "opened" : sort === "added" && q.words.length ? "relevance" : sort;
  return scored.sort((x, y) => by[effective](x[0], y[0], x[1], y[1])).map(([p]) => p);
}
