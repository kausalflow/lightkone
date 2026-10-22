import type { Paper, StorageAdapter } from "./types";

// PDFs live under papers/, filed the way Paperpile files them in Google
// Drive, so Paperpile's "All Papers" folder can be copied in as it is:
//   papers/All Papers/HINTON/Hinton et al. 2012 - Improving neural networks ....pdf
// A paper's `file` field (Paperpile's, or set here) is its path under papers/.
// The rules were read off a real Paperpile library of 1,669 files.

export const PDF_DIR = "papers/";
/** Where PDFs were kept before; they are moved to PDF_DIR when a library opens. */
export const OLD_PDF_DIR = "Paperpile/";
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

/** The author folder Paperpile files an author's papers under: the surname in capitals ("HINTON"). */
export const authorFolder = (author: string) => clean(surname(author)).toUpperCase();

/** Path under papers/, the same as Paperpile's BibTeX `file` field: as in its BibTeX `file` field: "All Papers/HINTON/Hinton et al. 2012 - ....pdf". */
export function paperpileFile(p: Pick<Paper, "authors" | "year" | "title">): string {
  const first = p.authors[0] ? authorFolder(p.authors[0]) : "";
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
  const taken = new Set(library.filter((q) => q.id !== p.id).flatMap((q) => [q.pdf, ...(q.file ?? "").split(";").map((f) => PDF_DIR + f.trim())]));
  const file = paperpileFile(p);
  let candidate = file;
  for (let i = 2; taken.has(PDF_DIR + candidate); i++) candidate = file.replace(/\.pdf$/, ` (${i}).pdf`);
  return { pdf: PDF_DIR + candidate, file: candidate };
}

/**
 * Move PDFs kept in the old place (Paperpile/All Papers/...) to papers/, and
 * say which papers now point where. Only copies: `removeOld` takes the old
 * files away, to be called once the library is saved with the new paths.
 */
export async function moveOldPdfs(
  storage: StorageAdapter,
  papers: Paper[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ repointed: Map<string, string>; removeOld: () => Promise<void> }> {
  const list = storage.listAll ?? storage.list;
  const old = (await list.call(storage, OLD_PDF_DIR).catch(() => [] as string[])).filter((k) => k.startsWith(OLD_PDF_DIR));
  const copied: string[] = [];
  for (const [i, k] of old.entries()) {
    const bytes = await storage.read(k);
    if (bytes) {
      await storage.write(PDF_DIR + k.slice(OLD_PDF_DIR.length), bytes, "application/pdf");
      copied.push(k);
    }
    onProgress?.(i + 1, old.length);
  }
  const moved = new Set(copied);
  const repointed = new Map<string, string>();
  for (const p of papers) if (p.pdf && moved.has(p.pdf)) repointed.set(p.id, PDF_DIR + p.pdf.slice(OLD_PDF_DIR.length));
  return {
    repointed,
    removeOld: async () => {
      if (storage.remove) for (const k of copied) await storage.remove(k);
    },
  };
}
