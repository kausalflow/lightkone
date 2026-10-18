import type { Paper } from "./types";

// Plain-text search over the fields people remember. Every word must match
// somewhere; title and author hits rank higher. Supports filters:
//   tag:"machine learning"  author:hinton  year:2019  year:2015-2020  has:pdf  has:abstract

export interface Query {
  words: string[];
  tags: string[];
  authors: string[];
  years?: [number, number];
  has: string[];
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function parseQuery(input: string): Query {
  const q: Query = { words: [], tags: [], authors: [], has: [] };
  const re = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)/g;
  for (const m of input.matchAll(re)) {
    const field = (m[1] ?? m[3])?.toLowerCase();
    const value = m[2] ?? m[4];
    if (field === "tag") q.tags.push(fold(value));
    else if (field === "author") q.authors.push(fold(value));
    else if (field === "has") q.has.push(value.toLowerCase());
    else if (field === "year") {
      const [a, b] = value.split("-").map(Number);
      if (a) q.years = [a, b || a];
    } else q.words.push(fold(m[5] ?? m[6] ?? m[0]));
  }
  return q;
}

function score(p: Paper, q: Query): number {
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
  if (!q.words.length) return 1;
  const title = fold(p.title);
  const rest = fold([p.abstract, p.venue, p.tags.join(" "), p.key, p.doi, p.arxiv, p.notes].filter(Boolean).join(" "));
  let total = 0;
  for (const w of q.words) {
    const s = (title.includes(w) ? 5 : 0) + (authorText.includes(w) ? 4 : 0) + (rest.includes(w) ? 1 : 0);
    if (!s) return 0;
    total += s;
  }
  return total;
}

export type SortBy = "added" | "year" | "title" | "relevance";

export function search(papers: Paper[], input: string, sort: SortBy = "added"): Paper[] {
  const q = parseQuery(input);
  const scored = papers.map((p) => [p, score(p, q)] as const).filter(([, s]) => s > 0);
  const by: Record<SortBy, (a: Paper, b: Paper, sa: number, sb: number) => number> = {
    relevance: (a, b, sa, sb) => sb - sa || b.added.localeCompare(a.added),
    added: (a, b) => b.added.localeCompare(a.added),
    year: (a, b) => (b.year ?? 0) - (a.year ?? 0),
    title: (a, b) => a.title.localeCompare(b.title),
  };
  const effective = sort === "added" && q.words.length ? "relevance" : sort;
  return scored.sort((x, y) => by[effective](x[0], y[0], x[1], y[1])).map(([p]) => p);
}
