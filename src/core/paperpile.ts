import type { Paper } from "./types";

// PDFs copied over from Paperpile's Google Drive folder (see docs/STORAGE.md)
// sit under this folder in storage, with Paperpile's own paths:
//   lightkone/paperpile/All Papers/H/Hinton et al. 2012 - Improving ....pdf
// Each paper's `file` field from Paperpile's BibTeX names its path, so the two
// can be matched up without renaming anything.
export const PAPERPILE_DIR = "lightkone/paperpile/";

const norm = (s: string) => s.normalize("NFC").trim().replace(/\.pdf$/i, "").toLowerCase();
const base = (s: string) => s.slice(s.lastIndexOf("/") + 1);

/**
 * For papers with a Paperpile `file` path and no PDF yet, find the copied PDF.
 * `keys` are storage paths as listed under PAPERPILE_DIR. Returns paper id → storage path.
 * Paths match exactly first (ignoring case and a missing ".pdf"), then by file name alone,
 * in case the folder was copied one level higher or lower.
 */
export function matchPaperpilePdfs(papers: Paper[], keys: string[]): Map<string, string> {
  const byPath = new Map<string, string>();
  const byName = new Map<string, string | null>();
  for (const k of keys) {
    byPath.set(norm(k.startsWith(PAPERPILE_DIR) ? k.slice(PAPERPILE_DIR.length) : k), k);
    const n = norm(base(k));
    byName.set(n, byName.has(n) ? null : k); // a name that appears twice is ambiguous
  }
  const found = new Map<string, string>();
  for (const p of papers) {
    if (p.pdf || !p.file) continue;
    const parts = p.file.split(";").map((s) => s.trim()).filter(Boolean);
    const hit = parts.map((f) => byPath.get(norm(f))).find(Boolean) ?? parts.map((f) => byName.get(norm(base(f)))).find(Boolean);
    if (hit) found.set(p.id, hit);
  }
  return found;
}
