import type { Paper } from "./types";
import { retrieve, type Source } from "./ask";

// Writing helpers: find the papers in the library that back a sentence, and
// make the .bib for a LaTeX manuscript from the keys it cites.

/** Every citation key in LaTeX source, in order of first use. Comments are ignored. */
export function citeKeysIn(tex: string): string[] {
  const code = tex.replace(/(^|[^\\])%.*$/gm, "$1");
  const keys: string[] = [];
  const re = /\\(?:no)?(?:[a-zA-Z]*cite[a-zA-Z]*|footcite[a-z]*)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)\}/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    for (const k of m[1].split(",").map((s) => s.trim())) if (k && k !== "*" && !keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** The papers a manuscript cites, matched by key (exactly, else ignoring case), and the keys not in the library. */
export function papersForKeys(papers: Paper[], keys: string[]): { found: Paper[]; missing: string[] } {
  const live = papers.filter((p) => !p.trashed);
  const exact = new Map(live.map((p) => [p.key, p]));
  const loose = new Map(live.map((p) => [p.key.toLowerCase(), p]));
  const found: Paper[] = [];
  const missing: string[] = [];
  for (const k of keys) {
    const p = exact.get(k) ?? loose.get(k.toLowerCase());
    if (p) {
      if (!found.includes(p)) found.push(p);
    } else missing.push(k);
  }
  return { found, missing };
}

export interface Candidate {
  paper: Paper;
  /** The passages that matched best, best first. */
  passages: Source[];
}

/** Papers that may back a sentence, best first, each with the passages that matched. */
export function candidatesFor(papers: Paper[], texts: Map<string, string>, sentence: string, max = 8): Candidate[] {
  const byId = new Map(papers.map((p) => [p.id, p]));
  const sources = retrieve(papers, texts, sentence, { max: max * 2, perPaper: 2, papers: max });
  const out = new Map<string, Candidate>();
  for (const s of sources) {
    const p = byId.get(s.paperId);
    if (!p) continue;
    if (!out.has(p.id)) out.set(p.id, { paper: p, passages: [] });
    out.get(p.id)!.passages.push(s);
  }
  return [...out.values()].slice(0, max);
}

export const citeCommand = (keys: string[], cmd = "cite") => `\\${cmd}{${keys.join(",")}}`;

export interface Verdict {
  /** The source number Claude judged. */
  n: number;
  support: "supports" | "related" | "no";
  /** The words in the source that back the sentence. */
  quote?: string;
}

/** Claude's verdicts, from a JSON array in its reply. */
export function parseVerdicts(text: string): Verdict[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<Verdict>[];
    return raw
      .filter((v) => typeof v.n === "number" && ["supports", "related", "no"].includes(v.support as string))
      .map((v) => ({ n: v.n!, support: v.support!, quote: typeof v.quote === "string" && v.quote.trim() ? v.quote.trim() : undefined }));
  } catch {
    return [];
  }
}
