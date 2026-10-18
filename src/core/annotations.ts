import type { Paper } from "./types";

// Highlights and notes on a PDF, kept next to the library as plain JSON so any
// tool can read them: lightkone/annotations/<paper id>.json

/** [x, y, width, height] as fractions of the page's width and height. */
export type Rect = [number, number, number, number];

export interface Highlight {
  id: string;
  /** 1-based page number. */
  page: number;
  rects: Rect[];
  text: string;
  note?: string;
  /** ISO timestamp. */
  created: string;
}

export interface AnnotationFile {
  format: "lightkone-annotations";
  version: 1;
  paper: string;
  highlights: Highlight[];
}

export const annotationsPath = (paperId: string) => `lightkone/annotations/${paperId}.json`;

export function parseAnnotations(raw: string | null, paperId: string): Highlight[] {
  if (!raw) return [];
  const file = JSON.parse(raw) as AnnotationFile;
  if (file.format !== "lightkone-annotations" || file.paper !== paperId) return [];
  return file.highlights ?? [];
}

export function serializeAnnotations(paperId: string, highlights: Highlight[]): string {
  const file: AnnotationFile = { format: "lightkone-annotations", version: 1, paper: paperId, highlights: sortHighlights(highlights) };
  return JSON.stringify(file, null, 1);
}

/** Reading order: by page, then top to bottom, then left to right. */
export function sortHighlights(hs: Highlight[]): Highlight[] {
  const top = (h: Highlight) => h.rects[0]?.[1] ?? 0;
  const left = (h: Highlight) => h.rects[0]?.[0] ?? 0;
  return [...hs].sort((a, b) => a.page - b.page || top(a) - top(b) || left(a) - left(b));
}

/**
 * Selection rectangles from the browser come one per text span, often
 * overlapping. Join the ones that sit on the same line into one box per line.
 */
export function mergeRects(rects: Rect[]): Rect[] {
  const sorted = rects.filter(([, , w, h]) => w > 0 && h > 0).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const sameLine = last && Math.abs(last[1] + last[3] / 2 - (r[1] + r[3] / 2)) < Math.min(last[3], r[3]) / 2;
    if (sameLine && r[0] <= last[0] + last[2] + 0.02) {
      const x = Math.min(last[0], r[0]);
      const y = Math.min(last[1], r[1]);
      last[2] = Math.max(last[0] + last[2], r[0] + r[2]) - x;
      last[3] = Math.max(last[1] + last[3], r[1] + r[3]) - y;
      last[0] = x;
      last[1] = y;
    } else {
      out.push([...r]);
    }
  }
  return out;
}

/** Highlights and notes as a Markdown note, e.g. for Obsidian. */
export function annotationsToMarkdown(p: Paper, highlights: Highlight[]): string {
  const authors = p.authors.length > 3 ? `${p.authors[0].split(",")[0]} et al.` : p.authors.map((a) => a.split(",")[0]).join(", ");
  const lines = [`# ${p.title}`, "", [authors, p.year, p.venue].filter(Boolean).join(" · "), "", `Citation key: @${p.key}`];
  const link = p.arxiv ? `https://arxiv.org/abs/${p.arxiv}` : p.doi ? `https://doi.org/${p.doi}` : p.url;
  if (link) lines.push(`Link: ${link}`);
  lines.push("", "## Highlights", "");
  if (!highlights.length) lines.push("No highlights yet.", "");
  for (const h of sortHighlights(highlights)) {
    lines.push(...h.text.trim().split(/\n+/).map((l) => `> ${l}`), `> (p. ${h.page})`, "");
    if (h.note?.trim()) lines.push(h.note.trim(), "");
  }
  return lines.join("\n");
}
