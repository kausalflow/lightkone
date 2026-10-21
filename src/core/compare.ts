import type { Paper } from "./types";
import { shortAuthors } from "./cite";
import { sourceLabel, type Source } from "./ask";

// Compare papers: a table of values read out of each paper, where papers
// agree or disagree on a claim, and a draft literature review of a set of
// papers. Claude does the reading; this file shapes what it is given and
// reads back what it returns.

/** The most of a paper's text Claude reads for a table: about 35k tokens. */
export const MAX_TEXT = 140_000;

/** A paper as Claude reads it for a table: its page-marked text, or its abstract when there is no PDF text. */
export function paperText(p: Paper, text: string | undefined, max = MAX_TEXT): { text: string; full: boolean; cut: boolean } {
  if (text?.trim()) return { text: text.length > max ? text.slice(0, max) : text, full: true, cut: text.length > max };
  return { text: [p.abstract && `Abstract: ${p.abstract}`, p.notes && `The researcher's notes: ${p.notes}`].filter(Boolean).join("\n\n"), full: false, cut: false };
}

export interface Cell {
  value: string;
  /** Page of the PDF the value is read from; 0 for the abstract or when not given. */
  page: number;
  quote?: string;
}

/** The first JSON object or array in a reply, tolerating a code fence or a stray sentence around it. */
export function parseJson<T>(text: string, open: "{" | "["): T | null {
  const start = text.indexOf(open);
  const end = text.lastIndexOf(open === "{" ? "}" : "]");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** One row of the table, from Claude's reply: a cell per column, in the columns' order. */
export function parseRow(text: string, columns: string[]): Cell[] | null {
  const raw = parseJson<{ cells?: { column?: string; value?: unknown; page?: unknown; quote?: unknown }[] }>(text, "{");
  if (!raw?.cells || !Array.isArray(raw.cells)) return null;
  const byName = new Map(raw.cells.map((c) => [String(c.column ?? "").trim().toLowerCase(), c]));
  return columns.map((col, i) => {
    const c = byName.get(col.trim().toLowerCase()) ?? raw.cells![i];
    const value = c && c.value != null ? String(c.value).trim() : "";
    const page = Number(c?.page);
    return { value: value || "—", page: Number.isInteger(page) && page > 0 ? page : 0, quote: typeof c?.quote === "string" && c.quote.trim() ? c.quote.trim() : undefined };
  });
}

/** Columns typed as "Method, Data; Main result" or one per line. */
export const parseColumns = (s: string) => [...new Set(s.split(/[\n,;]+/).map((c) => c.trim()).filter(Boolean))].slice(0, 12);

export interface Row {
  paperId: string;
  cells: Cell[] | null;
  /** Read from the abstract only, as there was no PDF text. */
  abstractOnly?: boolean;
  error?: string;
}

const csvCell = (s: string | number | undefined) => {
  const t = String(s ?? "");
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** The table as CSV: the paper's details, then each column and the page it is from. */
export function toCsv(rows: Row[], columns: string[], byId: Map<string, Paper>): string {
  const head = ["Title", "Authors", "Year", "Key", "DOI", "arXiv", ...columns.flatMap((c) => [c, `${c} (page)`])];
  const lines = rows.map((r) => {
    const p = byId.get(r.paperId);
    return [p?.title, p?.authors.join("; "), p?.year, p?.key, p?.doi, p?.arxiv, ...columns.flatMap((_, i) => [r.cells?.[i]?.value ?? r.error ?? "", r.cells?.[i]?.page || ""])];
  });
  return [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Text for a LaTeX table: special characters escaped, except inside $...$ math. */
const tex = (s: string) =>
  s
    .split(/(\$[^$]+\$)/)
    .map((part, i) => (i % 2 ? part : part.replace(/([&%#_{}])/g, "\\$1").replace(/\$/g, "\\$")))
    .join("");

/** The table as a LaTeX tabular, one row per paper cited by its key. */
export function toLatex(rows: Row[], columns: string[], byId: Map<string, Paper>): string {
  const spec = `l${"p{0.18\\linewidth}".repeat(columns.length)}`;
  const body = rows.map((r) => {
    const p = byId.get(r.paperId);
    const name = p ? `${tex(shortAuthors(p.authors) || p.title.slice(0, 30))}${p.year ? ` (${p.year})` : ""} \\cite{${p.key}}` : "";
    return `${name} & ${columns.map((_, i) => tex(r.cells?.[i]?.value ?? "")).join(" & ")} \\\\`;
  });
  return [`\\begin{tabular}{${spec}}`, "\\hline", `Paper & ${columns.map(tex).join(" & ")} \\\\`, "\\hline", ...body, "\\hline", "\\end{tabular}"].join("\n") + "\n";
}

/** Run `work` over items, a few at a time, in order of the items. */
export async function inTurn<T>(items: T[], at: number, work: (item: T, i: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  let next = 0;
  const one = async () => {
    while (next < items.length && !signal?.aborted) {
      const i = next++;
      await work(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(at, items.length) }, one));
}

// Agree or disagree

export type Stance = "supports" | "qualifies" | "contradicts";
export const STANCES: { id: Stance; label: string }[] = [
  { id: "supports", label: "Supports" },
  { id: "qualifies", label: "Qualifies" },
  { id: "contradicts", label: "Contradicts" },
];

export interface Point {
  stance: Stance;
  /** What the sources say, in a sentence or two. */
  text: string;
  /** Numbers of the sources it is read from. */
  sources: number[];
}

export interface Weighing {
  /** Where the agreement and disagreement lie, in a short paragraph. */
  summary: string;
  points: Point[];
}

/** Claude's reading of the sources against a claim. */
export function parseWeighing(text: string, known: Set<number>): Weighing | null {
  const raw = parseJson<{ summary?: unknown; points?: { stance?: unknown; text?: unknown; sources?: unknown }[] }>(text, "{");
  if (!raw || !Array.isArray(raw.points)) return null;
  return {
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    points: raw.points
      .filter((p) => STANCES.some((s) => s.id === p.stance) && typeof p.text === "string" && p.text.trim())
      .map((p) => ({
        stance: p.stance as Stance,
        text: (p.text as string).trim(),
        sources: (Array.isArray(p.sources) ? p.sources : []).map(Number).filter((n) => known.has(n)),
      })),
  };
}

/** The papers among the chosen ones that no point draws on: they don't address the claim, as far as the passages show. */
export function silentPapers(papers: Paper[], points: Point[], sources: Source[]): Paper[] {
  const used = new Set(points.flatMap((p) => p.sources).map((n) => sources.find((s) => s.n === n)?.paperId));
  return papers.filter((p) => !used.has(p.id));
}

/** The weighing as Markdown, with each source named by author, year and page. */
export function weighingMarkdown(claim: string, w: Weighing, sources: Source[], byId: Map<string, Paper>): string {
  const name = (n: number) => {
    const s = sources.find((x) => x.n === n);
    return s ? sourceLabel(s, byId.get(s.paperId)) : `[${n}]`;
  };
  const parts = [`# ${claim}`, "", w.summary];
  for (const s of STANCES) {
    const ps = w.points.filter((p) => p.stance === s.id);
    if (!ps.length) continue;
    parts.push("", `## ${s.label}`, "", ...ps.map((p) => `- ${p.text}${p.sources.length ? ` (${p.sources.map(name).join("; ")})` : ""}`));
  }
  return parts.join("\n") + "\n";
}

// Literature review

export type ReviewFormat = "latex" | "markdown";

/** Every paper as Claude reads it for a review: key, who, when, abstract, the researcher's notes, and the opening of the text when there is no abstract. */
export function reviewSources(papers: Paper[], texts: Map<string, string>): string {
  return papers
    .map((p) => {
      const text = texts.get(p.id);
      const opening = !p.abstract && text ? text.replace(/\[page \d+\]\s*/g, "").replace(/\s+/g, " ").slice(0, 3000) : "";
      return [
        `<paper key="${p.key}">`,
        `Title: ${p.title}`,
        p.authors.length ? `Authors: ${p.authors.slice(0, 8).join("; ")}${p.authors.length > 8 ? "; et al." : ""}` : "",
        p.year ? `Year: ${p.year}` : "",
        p.venue ? `Venue: ${p.venue}` : "",
        p.abstract ? `Abstract: ${p.abstract}` : "",
        opening ? `Opening of the text: ${opening}` : "",
        p.notes ? `The researcher's notes: ${p.notes}` : "",
        "</paper>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

/** Citation keys in a draft: \cite{a,b}, \citep[p.~3]{a}, [@a; @b]. */
export function keysIn(draft: string): string[] {
  const keys = new Set<string>();
  for (const m of draft.matchAll(/\\[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g)) for (const k of m[1].split(",")) if (k.trim()) keys.add(k.trim());
  for (const group of draft.matchAll(/\[[^\]]*@[^\]]*\]/g)) for (const m of group[0].matchAll(/@([\w:.#$%&\-+?<>~/]*\w)/g)) keys.add(m[1]);
  return [...keys];
}
