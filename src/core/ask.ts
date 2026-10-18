import type { Paper } from "./types";
import { shortAuthors } from "./cite";

// Ask your library: find the passages most likely to answer a question, from
// the full texts of the PDFs and from every paper's title and abstract, so
// Claude can answer from them and cite each claim with its paper and page.

export interface Source {
  /** Number Claude cites, [1], [2], … */
  n: number;
  paperId: string;
  /** Page in the PDF, or 0 for the title and abstract. */
  page: number;
  text: string;
}

const STOP = new Set(
  "the and for are was were with that this from what which how does did can could would should into onto than then them they their there these those about over under between have has had not but its any all our your you who whom why when where also more most such only very much many some each other using used use via per one two paper papers work show shows known".split(" "),
);

/** The words of a question worth looking for: lowercase, three letters or more, no common words. */
export function terms(question: string): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]*[\p{L}\p{N}]/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)))];
}

function count(hay: string, word: string, cap = 50): number {
  let n = 0;
  for (let at = hay.indexOf(word); at >= 0 && n < cap; at = hay.indexOf(word, at + word.length)) n++;
  return n;
}

/** Pages split into passages of about `size` characters, broken at a space. */
export function chunks(text: string, size = 1400): { page: number; text: string }[] {
  const out: { page: number; text: string }[] = [];
  text.split("\n\f\n").forEach((raw, i) => {
    const page = raw.replace(/^\[page \d+\]\s*/, "").replace(/\s+/g, " ").trim();
    for (let at = 0; at < page.length; ) {
      let end = Math.min(page.length, at + size);
      if (end < page.length) end = page.lastIndexOf(" ", end) > at + size / 2 ? page.lastIndexOf(" ", end) : end;
      out.push({ page: i + 1, text: page.slice(at, end).trim() });
      at = end;
    }
  });
  return out.filter((c) => c.text.length > 40);
}

const about = (p: Paper) => [p.title, p.abstract, p.notes].filter(Boolean).join("\n\n");

// Each paper's text in lower case, kept between questions; made again only when the paper or its text changes.
const lowered = new Map<string, { own: string; full: string | undefined; low: string }>();
function lowerOf(p: Paper, full: string | undefined): string {
  const own = about(p);
  const hit = lowered.get(p.id);
  if (hit && hit.own === own && hit.full === full) return hit.low;
  const low = `${own}\n${full ?? ""}`.toLowerCase();
  lowered.set(p.id, { own, full, low });
  return low;
}

/**
 * The passages to answer a question from, best first. Papers are ranked by how
 * often the rarer words of the question occur in them; the best of them are cut
 * into passages, which are ranked the same way, a few per paper at most.
 */
export function retrieve(papers: Paper[], texts: Map<string, string>, question: string, opts: { max?: number; perPaper?: number; papers?: number } = {}): Source[] {
  const { max = 24, perPaper = 4 } = opts;
  const words = terms(question);
  if (!words.length) return [];
  const live = papers.filter((p) => !p.trashed);
  const lowered = new Map(live.map((p) => [p.id, lowerOf(p, texts.get(p.id))]));

  // A word found in few papers says more than one found in all of them.
  const idf = new Map(words.map((w) => {
    let df = 0;
    for (const t of lowered.values()) if (t.includes(w)) df++;
    return [w, Math.log(1 + (live.length - df + 0.5) / (df + 0.5))];
  }));
  const weigh = (hay: string, len: number, avg: number) =>
    words.reduce((s, w) => {
      const f = count(hay, w);
      return s + (idf.get(w)! * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * len) / avg));
    }, 0);

  const avgDoc = [...lowered.values()].reduce((s, t) => s + t.length, 0) / Math.max(1, lowered.size);
  const ranked = live
    .map((p) => {
      const t = lowered.get(p.id)!;
      const title = p.title.toLowerCase();
      return { p, score: weigh(t, t.length, avgDoc) + words.reduce((s, w) => s + (title.includes(w) ? idf.get(w)! : 0), 0) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.papers ?? 30);

  const passages: Omit<Source, "n">[] = [];
  for (const { p } of ranked) {
    const own = about(p);
    if (own) passages.push({ paperId: p.id, page: 0, text: own });
    const full = texts.get(p.id);
    if (full) for (const c of chunks(full)) passages.push({ paperId: p.id, page: c.page, text: c.text });
  }
  const avg = passages.reduce((s, c) => s + c.text.length, 0) / Math.max(1, passages.length);
  const scored = passages
    .map((c) => ({ c, score: weigh(c.text.toLowerCase(), c.text.length, avg) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const per = new Map<string, number>();
  const picked: Omit<Source, "n">[] = [];
  for (const { c } of scored) {
    if (picked.length >= max) break;
    const k = per.get(c.paperId) ?? 0;
    if (k >= perPaper) continue;
    per.set(c.paperId, k + 1);
    picked.push(c);
  }
  // Grouped by paper and page, so neighbouring passages read in order.
  const order = new Map(ranked.map((r, i) => [r.p.id, i]));
  picked.sort((a, b) => order.get(a.paperId)! - order.get(b.paperId)! || a.page - b.page);
  return picked.map((c, i) => ({ ...c, n: i + 1 }));
}

/** How a source is named to the reader: "Jumper et al. 2021, p. 3". */
export function sourceLabel(s: Source, p: Paper | undefined): string {
  const who = p ? `${shortAuthors(p.authors) || p.title.slice(0, 40)}${p.year ? ` ${p.year}` : ""}` : "Unknown paper";
  return s.page ? `${who}, p. ${s.page}` : `${who}, abstract`;
}

const attr = (s: string) => s.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/** The sources as Claude reads them. */
export function sourcesPrompt(sources: Source[], byId: Map<string, Paper>): string {
  return sources
    .map((s) => {
      const p = byId.get(s.paperId);
      const title = p ? `${p.title}${p.year ? ` (${p.year})` : ""}` : "";
      return `<source n="${s.n}" paper="${attr(title)}" authors="${attr(p?.authors.slice(0, 6).join("; ") ?? "")}" ${s.page ? `page="${s.page}"` : `part="title and abstract"`}>\n${s.text}\n</source>`;
    })
    .join("\n\n");
}

/** Turn [3] and [3, 5] in rendered HTML into links to the sources, outside tags and math. */
export function linkCitations(html: string, label: (n: number) => string | null): string {
  let depth = 0; // inside KaTeX output
  let code = false;
  return html.replace(/(<[^>]*>)|([^<]+)/g, (m, tag: string | undefined, text: string | undefined) => {
    if (tag) {
      if (depth && /^<span/.test(tag)) depth++;
      else if (/^<span[^>]*class="katex(?:-display)?"/.test(tag)) depth = 1;
      else if (depth && tag === "</span>") depth--;
      else if (/^<code|^<div class="math"/.test(tag)) code = true;
      else if (tag === "</code>" || (code && tag === "</div>")) code = false;
      return tag;
    }
    if (depth || code) return m;
    return text!.replace(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g, (whole, list: string) => {
      const links = list.split(/\s*[,;]\s*/).map((s) => {
        const n = Number(s);
        const name = label(n);
        return name ? `<a href="#" class="src" data-src="${n}">${attr(name)}</a>` : null;
      });
      return links.every(Boolean) ? `<span class="srcs">${links.join("; ")}</span>` : whole;
    });
  });
}
