import type { Paper } from "./types";
import { retrieve, type Source } from "./ask";

// Papers named in a chat with [[key]], as in Obsidian: typing [[ searches the
// library, and each paper named joins what Claude reads for that question.

const MENTION = /\[\[([^\]\n]+)\]\]/g;

/** What is being typed after an open [[, up to the caret, or null when none is open. */
export function openMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /\[\[([^\]\n[]*)$/.exec(before);
  return m ? { start: m.index, query: m[1] } : null;
}

/** Papers matching what was typed after [[: every word in the title, authors, year or key. */
export function mentionMatches(papers: Paper[], query: string, limit = 8): Paper[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const live = papers.filter((p) => !p.trashed);
  if (!words.length) return [...live].sort((a, b) => (b.opened ?? b.added ?? "").localeCompare(a.opened ?? a.added ?? "")).slice(0, limit);
  const hay = (p: Paper) => `${p.key} ${p.title} ${p.authors.join(" ")} ${p.year ?? ""}`.toLowerCase();
  const scored = live
    .map((p) => {
      const h = hay(p);
      if (!words.every((w) => h.includes(w))) return null;
      // A key or a first author that starts with the words comes first.
      const lead = p.key.toLowerCase().startsWith(words[0]) || (p.authors[0] ?? "").toLowerCase().includes(words[0]) ? 0 : 1;
      return { p, lead };
    })
    .filter(Boolean) as { p: Paper; lead: number }[];
  return scored.sort((a, b) => a.lead - b.lead || (b.p.year ?? 0) - (a.p.year ?? 0)).slice(0, limit).map((x) => x.p);
}

/** Put [[key]] in place of the open [[query; returns the new text and where the caret goes. */
export function insertMention(text: string, caret: number, start: number, key: string): { text: string; caret: number } {
  const after = text.slice(caret).replace(/^[^\]\s]*\]\]/, "");
  const ins = `[[${key}]] `;
  return { text: text.slice(0, start) + ins + after.replace(/^ /, ""), caret: start + ins.length };
}

/** The library papers a text names with [[key]], in order, once each. */
export function mentionsIn(text: string, papers: Paper[]): Paper[] {
  const byKey = new Map(papers.map((p) => [p.key.toLowerCase(), p]));
  const out: Paper[] = [];
  for (const m of text.matchAll(MENTION)) {
    const p = byKey.get(m[1].trim().toLowerCase());
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/** A short name for a paper named in a question: "Vaswani et al. 2017". */
export function mentionLabel(p: Paper): string {
  const first = p.authors[0]?.split(",")[0].trim();
  const who = !first ? p.title.slice(0, 40) : p.authors.length > 2 ? `${first} et al.` : p.authors.length === 2 ? `${first} and ${p.authors[1].split(",")[0].trim()}` : first;
  return `${who}${p.year ? ` ${p.year}` : ""}`;
}

/** The text with each [[key]] written as the paper's short name; with its key too, for Claude. */
export function mentionsAsNames(text: string, papers: Paper[], withKey = true): string {
  const byKey = new Map(papers.map((p) => [p.key.toLowerCase(), p]));
  return text.replace(MENTION, (whole, key: string) => {
    const p = byKey.get(key.trim().toLowerCase());
    return p ? (withKey ? `${mentionLabel(p)} [${p.key}]` : mentionLabel(p)) : whole;
  });
}

/**
 * Passages from the papers named, so each one is read even when the search
 * over the rest would not pick it: the best few for the question, or its
 * title and abstract when nothing in it matches the words.
 */
export function mentionedPassages(named: Paper[], texts: Map<string, string>, question: string, perPaper = 3): Source[] {
  const out: Source[] = [];
  for (const p of named) {
    const found = retrieve([p], texts, question, { max: perPaper, perPaper });
    if (found.length) out.push(...found);
    else out.push({ n: 0, paperId: p.id, page: 0, text: [p.title, p.abstract].filter(Boolean).join("\n\n") });
  }
  return out;
}
