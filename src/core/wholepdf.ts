import type { Paper } from "./types";
import type { Source } from "./ask";

// Ask with whole PDFs: for a handful of papers, Claude reads the PDFs
// themselves rather than passages found in their text, so answers can use
// figures, tables and equations. Claude's citations feature says which page
// each point comes from; here those become the numbered sources the rest of
// Ask already links to the page.

/** Papers read whole at most; past this, passages are found instead. */
export const WHOLE_MAX = 5;
/** PDF bytes sent in one request at most: the API takes 32 MB, and base64 adds a third. */
export const WHOLE_BYTES = 22 * 1024 * 1024;

/** A document given to Claude: a paper's PDF, or its title and abstract when there is no PDF to send. */
export interface Doc {
  paperId: string;
  kind: "pdf" | "abstract";
}

/** The papers to read whole, chosen and named together, or null when there are too many or one has no PDF. */
export function wholeSet(chosen: Paper[], named: Paper[] = []): Paper[] | null {
  const byId = new Map<string, Paper>();
  for (const p of [...chosen, ...named]) byId.set(p.id, p);
  const all = [...byId.values()];
  if (!all.length || all.length > WHOLE_MAX || all.some((p) => !p.pdf)) return null;
  return all;
}

/** One citation as the API gives it, the parts used here. */
export interface CitationLike {
  type: string;
  cited_text: string;
  document_index: number;
  start_page_number?: number;
}

/** A text block of Claude's answer, with the citations that back it. */
export interface CitedBlock {
  text: string;
  citations: CitationLike[];
}

const key = (s: Pick<Source, "paperId" | "page" | "text">) => `${s.paperId}:${s.page}:${s.text}`;

/**
 * Claude's answer as Markdown with [n] after each cited stretch, and the new
 * sources those numbers point to, numbered after `base`. A passage cited
 * twice keeps its number. `docs` lists the documents in the order they were
 * sent, which is what each citation's document_index counts.
 */
export function citedAnswer(blocks: CitedBlock[], docs: Doc[], base: Source[]): { text: string; added: Source[] } {
  const known = new Map(base.map((s) => [key(s), s.n] as const));
  const added: Source[] = [];
  let out = "";
  for (const b of blocks) {
    const ns: number[] = [];
    for (const c of b.citations) {
      const doc = docs[c.document_index];
      const text = c.cited_text.replace(/\s+/g, " ").trim();
      if (!doc || !text) continue;
      const s = { paperId: doc.paperId, page: c.type === "page_location" ? (c.start_page_number ?? 0) : 0, text };
      let n = known.get(key(s));
      if (n === undefined) {
        n = base.length + added.length + 1;
        known.set(key(s), n);
        added.push({ n, ...s });
      }
      if (!ns.includes(n)) ns.push(n);
    }
    if (!ns.length) {
      out += b.text;
      continue;
    }
    // The number goes after the cited words, before a closing full stop or comma.
    const m = b.text.match(/^([\s\S]*?)([.,;:]?)(\s*)$/)!;
    out += `${m[1]} [${ns.join(", ")}]${m[2]}${m[3]}`;
  }
  return { text: out, added };
}

/** An earlier answer as Claude wrote it, without the numbers added here. */
export function withoutNumbers(md: string): string {
  return md.replace(/ ?\[\d+(?:, \d+)*\]/g, "");
}

/** An earlier answer as Claude wrote it, without the numbers added here for the given sources (others stay: Claude wrote them). */
export function withoutSources(md: string, ns: Set<number>): string {
  return md.replace(/ ?\[(\d+(?:, \d+)*)\]/g, (whole, list: string) => {
    const left = list.split(", ").filter((x) => !ns.has(Number(x)));
    return left.length === list.split(", ").length ? whole : left.length ? ` [${left.join(", ")}]` : "";
  });
}

/** The numbers an answer cites, in the order they first appear. */
export function citedNumbers(md: string): number[] {
  const out: number[] = [];
  for (const m of md.matchAll(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g)) {
    for (const x of m[1].split(/\s*[,;]\s*/)) {
      const n = Number(x);
      if (!out.includes(n)) out.push(n);
    }
  }
  return out;
}
