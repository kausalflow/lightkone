import type { Paper } from "./types";

// PDFs are filed the way Paperpile files them in Google Drive, so the same
// folder works with both, and a Drive storage plugin can later use it as is:
//   Paperpile/All Papers/HINTON/Hinton et al. 2012 - Improving neural networks ....pdf
// The rules were read off a real Paperpile library of 1,669 files.

export const PAPERPILE_DIR = "Paperpile/";
const ALL_PAPERS = "All Papers";

const surname = (a: string) => (a.includes(",") ? a.split(",")[0] : a).trim();

/** Characters a file name cannot hold become " - ", as Paperpile does ("Title: Subtitle" → "Title - Subtitle"). */
function clean(s: string): string {
  return s
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/[:/\\?*"<>|]/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/( - )+/g, " - ")
    .replace(/^[\s-]+|[\s-]+$/g, "");
}

function authorPart(authors: string[], title: string): string {
  const names = authors.map(surname).filter(Boolean);
  // With no authors Paperpile puts the title in their place.
  const s = names.length === 0 ? title : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} et al.`;
  return s.length > 40 ? `${s.slice(0, 37)}...` : s;
}

/** Path relative to the Paperpile folder, as in its BibTeX `file` field: "All Papers/HINTON/Hinton et al. 2012 - ....pdf". */
export function paperpileFile(p: Pick<Paper, "authors" | "year" | "title">): string {
  const first = p.authors[0] ? clean(surname(p.authors[0])).toUpperCase() : "";
  const title = clean(p.title) || "Untitled";
  const head = clean([authorPart(p.authors, title), p.year].filter(Boolean).join(" "));
  let name = `${head} - ${title}`;
  if (name.length > 146) name = `${name.slice(0, 72).trimEnd()} ... ${name.slice(-69).trimStart()}`;
  return `${ALL_PAPERS}/${first || "Other"}/${name}.pdf`;
}

/**
 * Where a new PDF for this paper goes: its storage path and the matching
 * Paperpile `file` value. A name another paper already uses gets " (2)", " (3)" ...
 */
export function pdfLocation(p: Paper, library: Paper[]): { pdf: string; file: string } {
  const taken = new Set(library.filter((q) => q.id !== p.id).flatMap((q) => [q.pdf, ...(q.file ?? "").split(";").map((f) => PAPERPILE_DIR + f.trim())]));
  const file = paperpileFile(p);
  let candidate = file;
  for (let i = 2; taken.has(PAPERPILE_DIR + candidate); i++) candidate = file.replace(/\.pdf$/, ` (${i}).pdf`);
  return { pdf: PAPERPILE_DIR + candidate, file: candidate };
}
