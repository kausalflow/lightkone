import type { Rect } from "./annotations";

// Finding a passage Claude quoted on the page it came from, so the reader can
// draw it right on the paper. Claude's quote and the PDF's text layer differ
// in spacing, line-end hyphens, ligatures and math, so both are compared as
// letters and digits only; when the whole quote is not found it is followed
// piece by piece.

/** One run of text on a page, with its box as fractions of the page. */
export interface TextBit {
  page: number;
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A passage found on one page: the boxes to draw, one per line. */
export interface Found {
  page: number;
  rects: Rect[];
}

const keep = /[\p{L}\p{N}]/u;

/** Letters and digits only, lowercase, ligatures opened: what is compared. */
export function squeeze(s: string): string {
  let out = "";
  for (const ch of s) {
    for (const c of ch.normalize("NFKC").toLowerCase()) if (keep.test(c)) out += c;
  }
  return out;
}

/** The squeezed text of the bits, and for each of its characters which bit and character it came from. */
function index(bits: TextBit[]): { text: string; at: [number, number][] } {
  let text = "";
  const at: [number, number][] = [];
  bits.forEach((b, i) => {
    let j = 0;
    for (const ch of b.str) {
      for (const c of ch.normalize("NFKC").toLowerCase()) {
        if (keep.test(c)) {
          text += c;
          at.push([i, j]);
        }
      }
      j += ch.length;
    }
  });
  return { text, at };
}

const CHUNK = 16;

/**
 * Where a squeezed quote lies in squeezed text, as one or more [start, end)
 * stretches; empty when it isn't there. When the quote is not there word for
 * word (math read differently, a caption or page number between its parts),
 * it is followed piece by piece: small differences are marked over, while
 * text the quote doesn't have, such as a figure caption, is left out.
 */
export function spans(text: string, quote: string): [number, number][] {
  if (!quote) return [];
  const i = text.indexOf(quote);
  if (i >= 0) return [[i, i + quote.length]];
  if (quote.length < CHUNK * 2) return [];
  const starts: number[] = [];
  for (let q = 0; q + CHUNK < quote.length; q += CHUNK) starts.push(q);
  starts.push(quote.length - CHUNK);
  // Each piece found, in order: its place in the quote and in the text.
  const hits: [number, number][] = [];
  for (const q of starts) {
    const piece = quote.slice(q, q + CHUNK);
    const last = hits[hits.length - 1];
    const from = last ? last[1] + Math.max(1, Math.min(CHUNK, q - last[0])) : 0;
    const t = text.indexOf(piece, from);
    if (t < 0 || (last && t - last[1] > (q - last[0]) * 2 + 600)) continue;
    hits.push([q, t]);
  }
  if (hits.length * CHUNK < quote.length * 0.4) return [];
  // Stretches as [text start, text end, quote start, quote end].
  const out: [number, number, number, number][] = [];
  for (let k = 0; k < hits.length; k++) {
    const [q, t] = hits[k];
    const prev = hits[k - 1];
    const last = out[out.length - 1];
    // Joined to the piece before when the text between them is about as long as the quote's.
    if (prev && last && t - (prev[1] + CHUNK) <= Math.max(0, q - (prev[0] + CHUNK)) * 1.5 + 8) {
      last[1] = Math.max(last[1], t + CHUNK);
      last[3] = q + CHUNK;
    } else out.push([t, t + CHUNK, q, q + CHUNK]);
  }
  // Each stretch grown letter by letter while text and quote still agree, past the pieces' edges.
  for (const r of out) {
    while (r[0] > 0 && r[2] > 0 && text[r[0] - 1] === quote[r[2] - 1]) r[0]--, r[2]--;
    while (r[1] < text.length && r[3] < quote.length && text[r[1]] === quote[r[3]]) r[1]++, r[3]++;
  }
  return out.map((r) => [r[0], r[1]]);
}

/**
 * Where a quoted passage is among a page's text bits (and the next page's,
 * when the quote runs over), as boxes per page; null when it isn't there.
 */
export function locate(bits: TextBit[], quote: string): Found[] | null {
  const { text, at } = index(bits);
  const found = spans(text, squeeze(quote));
  if (!found.length) return null;
  // The characters of each bit that are marked.
  const parts = new Map<number, [number, number]>();
  for (const s of found) {
    for (let c = s[0]; c < s[1]; c++) {
      const [i, j] = at[c];
      const p = parts.get(i);
      if (p) p[1] = Math.max(p[1], j + 1);
      else parts.set(i, [j, j + 1]);
    }
  }
  const pages = new Map<number, Rect[]>();
  // A page number or running head met on the way over a page break is not part of the passage.
  const edge = (b: TextBit) => b.y > 0.9 || b.y + b.h < 0.08;
  const body = [...parts.keys()].some((i) => !edge(bits[i]));
  for (const [i, [from, to]] of parts) {
    const b = bits[i];
    if (body && edge(b)) continue;
    const n = b.str.length || 1;
    const r: Rect = [b.x + (b.w * from) / n, b.y, (b.w * (to - from)) / n, b.h];
    if (r[2] <= 0 || r[3] <= 0) continue;
    pages.set(b.page, [...(pages.get(b.page) ?? []), r]);
  }
  const out = [...pages.entries()].map(([page, rects]) => ({ page, rects: lines(rects) }));
  return out.length ? out : null;
}

/** Boxes on the same line joined into one, a little padded. */
function lines(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: Rect[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[1] + last[3] / 2 - (r[1] + r[3] / 2)) < Math.min(last[3], r[3]) / 2 && r[0] <= last[0] + last[2] + 0.03) {
      const x = Math.min(last[0], r[0]);
      const y = Math.min(last[1], r[1]);
      last[2] = Math.max(last[0] + last[2], r[0] + r[2]) - x;
      last[3] = Math.max(last[1] + last[3], r[1] + r[3]) - y;
      last[0] = x;
      last[1] = y;
    } else out.push([...r]);
  }
  return out;
}
