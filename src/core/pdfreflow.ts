// PDF pages re-flowed for a small e-ink screen. A whole PDF page shrunk to a
// 4-inch screen is unreadable, and small readers can't open PDFs at all. So
// each page, drawn as grey pixels, is cut into its columns, text lines and
// words, and the words are laid out again in lines that fit a 480-pixel-wide
// screen at a readable size, as k2pdfopt does. Figures, tables and displayed
// equations (anything that isn't a line of text) are kept whole and shrunk to
// the screen's width when they're wider. The result is one picture per screen.
//
// Everything here works on grey pixels (one byte each, 0 black to 255 white),
// so it needs no browser; drawing the PDF pages is done elsewhere (pdf.js).

export interface GreyImage {
  width: number;
  height: number;
  grey: Uint8Array;
}

/** A rectangle, x0/y0 included and x1/y1 not. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One piece cut from a page: a word, or a block kept whole (figure, table, equation). */
export interface Piece {
  kind: "word" | "block";
  image: GreyImage;
  /** Words: how far the text's baseline is from the piece's top, in source pixels. */
  baseline: number;
  /** Words: the first word of a paragraph. */
  starts?: boolean;
  /** Words at a line's end: the width of a hyphen splitting the word, in source pixels, dropped when the word is joined up again. */
  hyphen?: number;
  /** The PDF page it came from, from 1. */
  page: number;
}

export interface ReflowLook {
  /** The screen picture's size. */
  width: number;
  height: number;
  /** Space kept clear at the picture's edges. */
  margin: number;
  /** The height of a line of text's ink (from the top of a "d" to the bottom of a "p"), in screen pixels. */
  line: number;
}

/** Sizes offered in settings, as the screen height of a line of text. */
export const REFLOW_LINES: Record<string, number> = { small: 22, medium: 26, large: 32 };
export const REFLOW_LOOK: ReflowLook = { width: 480, height: 760, margin: 10, line: REFLOW_LINES.medium };

/** Darker than this counts as ink. */
const INK = 170;

const ink = (img: GreyImage, x: number, y: number) => img.grey[y * img.width + x] < INK;

function rowInk(img: GreyImage, b: Box): Int32Array {
  const out = new Int32Array(b.y1 - b.y0);
  for (let y = b.y0; y < b.y1; y++) {
    let n = 0;
    const row = y * img.width;
    for (let x = b.x0; x < b.x1; x++) if (img.grey[row + x] < INK) n++;
    out[y - b.y0] = n;
  }
  return out;
}

function colInk(img: GreyImage, b: Box): Int32Array {
  const out = new Int32Array(b.x1 - b.x0);
  for (let y = b.y0; y < b.y1; y++) {
    const row = y * img.width;
    for (let x = b.x0; x < b.x1; x++) if (img.grey[row + x] < INK) out[x - b.x0]++;
  }
  return out;
}

/** Runs of indexes where counts are above zero, as [start, end) pairs, joining runs split by gaps shorter than minGap. */
export function runs(counts: ArrayLike<number>, minGap = 1): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  let lastInk = -1;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0) {
      if (start < 0) start = i;
      else if (i - lastInk - 1 >= minGap) {
        out.push([start, lastInk + 1]);
        start = i;
      }
      lastInk = i;
    }
  }
  if (start >= 0) out.push([start, lastInk + 1]);
  return out;
}

/** The box around the ink in a region, or null when it is blank. Specks (a scan's dust) count only when they have neighbours. */
export function inkBox(img: GreyImage, b: Box = { x0: 0, y0: 0, x1: img.width, y1: img.height }): Box | null {
  const rows = rowInk(img, b);
  const cols = colInk(img, b);
  const r = runs(rows);
  const c = runs(cols);
  if (!r.length || !c.length) return null;
  return { x0: b.x0 + c[0][0], y0: b.y0 + r[0][0], x1: b.x0 + c[c.length - 1][1], y1: b.y0 + r[r.length - 1][1] };
}

function crop(img: GreyImage, b: Box): GreyImage {
  const width = b.x1 - b.x0;
  const height = b.y1 - b.y0;
  const grey = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) grey.set(img.grey.subarray((b.y0 + y) * img.width + b.x0, (b.y0 + y) * img.width + b.x1), y * width);
  return { width, height, grey };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

interface Line {
  box: Box;
  baseline: number;
}

/**
 * The columns of a band of the page, left to right: a band of a two-column
 * paper is split at the white gutter near its middle; anything else is one
 * column. Each spans its column's whole width, so lines can be compared with it.
 */
export function columns(img: GreyImage, band: Box, minGutter: number): Box[] {
  const cols = colInk(img, band);
  const w = band.x1 - band.x0;
  let best: [number, number] | null = null;
  let start = -1;
  for (let x = 0; x <= w; x++) {
    const blank = x < w && cols[x] === 0;
    if (blank && start < 0) start = x;
    if (!blank && start >= 0) {
      const mid = (start + x) / 2;
      if (x - start >= minGutter && mid > w * 0.3 && mid < w * 0.7 && (!best || x - start > best[1] - best[0])) best = [start, x];
      start = -1;
    }
  }
  if (!best) return [band];
  return [
    { ...band, x1: band.x0 + best[0] },
    { ...band, x0: band.x0 + best[1] },
  ];
}

/**
 * The page's ink less what sits alone in a margin: arXiv's sideways stamp
 * ("arXiv:2312.00752v2 [cs.LG] 31 May 2024"), line numbers, a running mark.
 */
export function textArea(img: GreyImage, scale = img.width / 2550): Box | null {
  const all = inkBox(img);
  if (!all) return null;
  const parts = runs(colInk(img, all), Math.round(50 * scale)).map(([a, b]) => [all.x0 + a, all.x0 + b] as [number, number]);
  const narrow = (r: [number, number]) => r[1] - r[0] < img.width * 0.05;
  while (parts.length > 1 && narrow(parts[0])) parts.shift();
  while (parts.length > 1 && narrow(parts[parts.length - 1])) parts.pop();
  return inkBox(img, { x0: parts[0][0], y0: all.y0, x1: parts[parts.length - 1][1], y1: all.y1 });
}

/** The text lines (or other rows of ink) in a column, top to bottom, with small marks (accents, a lone subscript row) joined to their line. */
function lines(img: GreyImage, col: Box): Line[] {
  const rows = rowInk(img, col);
  let r = runs(rows);
  const h = median(r.map(([a, b]) => b - a));
  // Join thin runs (a bar over a letter, dots, a subscript that sits apart) to the nearer neighbour.
  const thin = (x: [number, number]) => x[1] - x[0] < h * 0.45;
  // A thin run goes with whichever neighbour is closer (a bar over a letter belongs to the line below it).
  const joined: [number, number][] = [];
  for (let i = 0; i < r.length; i++) {
    const run: [number, number] = [r[i][0], r[i][1]];
    const next = r[i + 1];
    if (thin(run) && next && next[0] - run[1] < h * 0.35) {
      const last = joined[joined.length - 1];
      if (!last || next[0] - run[1] <= run[0] - last[1]) {
        r[i + 1] = [run[0], next[1]];
        continue;
      }
    }
    const last = joined[joined.length - 1];
    if (last && (thin(run) || thin(last)) && run[0] - last[1] < h * 0.35) last[1] = run[1];
    else joined.push(run);
  }
  r = joined;
  return r.map(([a, b]) => {
    const box = { x0: col.x0, y0: col.y0 + a, x1: col.x1, y1: col.y0 + b };
    const tight = inkBox(img, box) ?? box;
    // The baseline: the lowest row that still has much ink (letters sit on it; only descenders go below).
    const seg = rows.subarray(a, b);
    const peak = Math.max(...seg);
    let base = b - a;
    for (let i = seg.length - 1; i >= 0; i--)
      if (seg[i] >= peak * 0.4) {
        base = i + 1;
        break;
      }
    return { box: tight, baseline: col.y0 + a + base - tight.y0 };
  });
}

/** The words of a line of text: ink separated by gaps wider than a letter's spacing. */
function words(img: GreyImage, line: Box, gap: number): Box[] {
  const cols = colInk(img, line);
  return runs(cols, gap).map(([a, b]) => ({ x0: line.x0 + a, y0: line.y0, x1: line.x0 + b, y1: line.y1 }));
}

/** Where the last line of text before this page sat in its column, so a paragraph can carry on across a page. */
export interface Carry {
  /** Gap from the column's left edge to the line, and from the line to the column's right edge, in text lines. */
  left: number;
  right: number;
}

/**
 * A hyphen at the end of a word (a short dash at mid-letter height, apart
 * from the letters): its width in pixels, or 0.
 */
export function trailingHyphen(img: GreyImage, word: Box, lineH: number, baseline: number): number {
  const parts = runs(colInk(img, word));
  if (parts.length < 2) return 0;
  const [a, b] = parts[parts.length - 1];
  const w = b - a;
  if (w < lineH * 0.1 || w > lineH * 0.5) return 0;
  const box = inkBox(img, { ...word, x0: word.x0 + a, x1: word.x0 + b });
  if (!box) return 0;
  const h = box.y1 - box.y0;
  const mid = (box.y0 + box.y1) / 2 - word.y0;
  if (h > lineH * 0.14 || h > w * 0.7) return 0;
  // Above the baseline, below the top of small letters (about half an x-height up).
  if (mid > baseline - lineH * 0.08 || mid < baseline - lineH * 0.55) return 0;
  return word.x1 - (word.x0 + parts[parts.length - 2][1]);
}

/**
 * Cuts one page (drawn as grey pixels) into pieces in reading order: words
 * from lines of text, and whole blocks for everything else. textLine is the
 * typical height of a line of text in this document's pixels, or 0 to measure
 * it from this page.
 */
export function cutPage(img: GreyImage, page: number, textLine = 0, carry?: Carry): { pieces: Piece[]; textLine: number; carry?: Carry } {
  const scale = img.width / 2550; // 1 at 300 dpi for a US letter page
  const all = textArea(img, scale);
  if (!all) return { pieces: [], textLine, carry };
  // Bands: stretches of the page separated by white rows across its whole width.
  const bandGap = Math.max(4, Math.round(18 * scale));
  const bands = runs(rowInk(img, all), bandGap).map(([a, b]) => ({ x0: all.x0, y0: all.y0 + a, x1: all.x1, y1: all.y0 + b }));
  // A page number or running head: one short line at the very top or bottom, set apart from the rest.
  const lone = (b: Box | undefined, next: Box | undefined) => {
    if (!b || !next || b.y1 - b.y0 > 55 * scale) return false;
    const ink = inkBox(img, b);
    return Boolean(ink && ink.x1 - ink.x0 < (all.x1 - all.x0) * 0.6 && Math.abs(next.y0 - b.y1) > 30 * scale);
  };
  if (bands.length >= 2 && lone(bands[bands.length - 1], bands[bands.length - 2]) && bands[bands.length - 1].y0 > img.height * 0.85) bands.pop();
  if (bands.length >= 2 && lone(bands[0], bands[1]) && bands[0].y1 < img.height * 0.15) bands.shift();
  const cols: Box[] = [];
  // Two-column stretches are read down the left column, then the right.
  let pending: Box[][] = [];
  const flush = () => {
    if (!pending.length) return;
    for (const side of [0, 1]) for (const pair of pending) if (pair[side]) cols.push(pair[side]);
    pending = [];
  };
  for (const band of bands) {
    const c = columns(img, band, Math.round(40 * scale));
    if (c.length === 2) pending.push(c);
    else {
      flush();
      cols.push(...c);
    }
  }
  flush();
  const found = cols.flatMap((c) => lines(img, c).map((l) => ({ ...l, col: c })));
  const measured = median(found.map((l) => l.box.y1 - l.box.y0).filter((h) => h > 4 * scale));
  const lineH = textLine || measured || Math.round(30 * scale);
  const pieces: Piece[] = [];
  let block: { box: Box } | null = null;
  const endBlock = () => {
    if (block) pieces.push({ kind: "block", image: crop(img, block.box), baseline: 0, page });
    block = null;
  };
  let prev: (typeof found)[number] | null = null;
  let prevStarted = false;
  // The same column: lines further down within the same left and right edges (bands of one column are separate boxes).
  const sameCol = (a: Box, b: Box) => Math.abs(a.x0 - b.x0) < lineH && Math.abs(a.x1 - b.x1) < lineH;
  for (const l of found) {
    const h = l.box.y1 - l.box.y0;
    const colW = l.col.x1 - l.col.x0;
    const ws = h <= lineH * 1.7 ? words(img, l.box, Math.max(2, Math.round(Math.min(h, lineH) * 0.25))) : [];
    const left = l.box.x0 - l.col.x0;
    const right = l.col.x1 - l.box.x1;
    // A displayed equation: a line set apart in the middle of its column.
    const centred = left > colW * 0.12 && right > colW * 0.12 && Math.abs(left - right) < colW * 0.15 && (!prev || l.box.y0 - prev.box.y1 > lineH * 0.25);
    const isText = !centred && (ws.length >= 2 || (ws.length === 1 && h <= lineH * 1.3 && l.box.x1 - l.box.x0 < colW * 0.6 && !block));
    if (!isText) {
      // Join a figure's or equation's rows into one block while they are close together.
      if (block && l.box.y0 - block.box.y1 < lineH * 0.9 && prev && sameCol(prev.col, l.col) && !centred)
        block.box = { x0: Math.min(block.box.x0, l.box.x0), y0: block.box.y0, x1: Math.max(block.box.x1, l.box.x1), y1: l.box.y1 };
      else {
        endBlock();
        block = { box: l.box };
      }
      prev = l;
      continue;
    }
    const wasBlock = block !== null;
    endBlock();
    const flow = prev && sameCol(prev.col, l.col) && l.box.y0 >= prev.box.y1 - 2;
    const indent = prev ? l.box.x0 - prev.box.x0 : 0;
    const prevShort = prev && prev.box.x1 < l.box.x1 - lineH * 2.5;
    const bigGap = prev && l.box.y0 - prev.box.y1 > lineH * 0.9;
    // A heading: taller than the text around it; it stands alone, and so does what follows it.
    const tall = h > lineH * 1.25 && ws.length <= 12;
    const prevTall = prev ? prev.box.y1 - prev.box.y0 > lineH * 1.25 : false;
    // At the top of a page or column, carry on the paragraph from the one before unless this line is indented.
    const starts: boolean =
      wasBlock || tall || prevTall
        ? true
        : !flow
          ? (() => {
              const before = prev ? { left: (prev.box.x0 - prev.col.x0) / lineH, right: (prev.col.x1 - prev.box.x1) / lineH } : carry;
              if (!before) return true;
              return left / lineH - before.left > 0.8 || before.right > 2.5;
            })()
          : // Indented after a paragraph's first line is a hanging indent (a list item, a reference), not a new paragraph.
            Boolean((indent > lineH * 0.8 && !prevStarted) || prevShort || bigGap);
    ws.forEach((w, i) => {
      const tight = inkBox(img, w) ?? w;
      const box = { x0: tight.x0, y0: l.box.y0, x1: tight.x1, y1: l.box.y1 };
      const hyphen = i === ws.length - 1 ? trailingHyphen(img, box, lineH, l.baseline) : 0;
      pieces.push({ kind: "word", image: crop(img, box), baseline: l.baseline, starts: i === 0 && starts, page, ...(hyphen ? { hyphen } : {}) });
    });
    prevStarted = starts;
    prev = l;
  }
  endBlock();
  const lastText = [...found].reverse().find((l) => l.box.y1 - l.box.y0 <= lineH * 1.3);
  const out = lastText ? { left: (lastText.box.x0 - lastText.col.x0) / lineH, right: (lastText.col.x1 - lastText.box.x1) / lineH } : carry;
  return { pieces, textLine: lineH, carry: out };
}

// ---------------------------------------------------------------- laying out screens

/** Draws src scaled by s into dst at (dx, dy), averaging the source pixels each screen pixel covers. Ink is kept dark. */
export function drawScaled(dst: GreyImage, src: GreyImage, dx: number, dy: number, s: number): void {
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const fx = src.width / w;
  const fy = src.height / h;
  for (let y = 0; y < h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    const sy0 = Math.floor(y * fy);
    const sy1 = Math.max(sy0 + 1, Math.min(src.height, Math.floor((y + 1) * fy)));
    for (let x = 0; x < w; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const sx0 = Math.floor(x * fx);
      const sx1 = Math.max(sx0 + 1, Math.min(src.width, Math.floor((x + 1) * fx)));
      let sum = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) sum += src.grey[sy * src.width + sx];
      const v = sum / ((sy1 - sy0) * (sx1 - sx0));
      const i = ty * dst.width + tx;
      if (v < dst.grey[i]) dst.grey[i] = v;
    }
  }
}

/** An image less its rightmost pixels. */
function cropRight(img: GreyImage, drop: number): GreyImage {
  return crop(img, { x0: 0, y0: 0, x1: Math.max(1, img.width - drop), y1: img.height });
}

const blank = (look: ReflowLook): GreyImage => ({ width: look.width, height: look.height, grey: new Uint8Array(look.width * look.height).fill(255) });

/**
 * Lays pieces out on screens. Feed it pieces page by page with add(); it calls
 * done(screen, firstPage) for each full screen. finish() sends the last one.
 */
export class Layout {
  private screen: GreyImage;
  private firstPage = 0;
  private y: number;
  private line: { piece: Piece; x: number; s: number; cut?: boolean }[] = [];
  private lineX: number;
  private used = false;
  /** Screen pixels per source pixel for text. */
  private s = 1;
  count = 0;

  constructor(
    private look: ReflowLook,
    private done: (screen: GreyImage, firstPage: number) => void | Promise<void>,
  ) {
    this.screen = blank(look);
    this.y = look.margin;
    this.lineX = look.margin;
  }

  /** Sets the text scale from the document's typical source line height. */
  setTextLine(sourceLine: number) {
    this.s = this.look.line / Math.max(1, sourceLine);
  }

  private get usable() {
    return this.look.width - 2 * this.look.margin;
  }
  private get pitch() {
    return Math.round(this.look.line * 1.3);
  }

  private async newScreen() {
    if (this.used) {
      this.count++;
      await this.done(this.screen, this.firstPage);
    }
    this.screen = blank(this.look);
    this.y = this.look.margin;
    this.used = false;
  }

  private async flushLine() {
    if (!this.line.length) return;
    if (this.y + this.pitch > this.look.height - this.look.margin) await this.newScreen();
    if (!this.used) this.firstPage = this.line[0].piece.page;
    // Words sit on a common baseline, a line's ink height below the top less its descent.
    const base = this.y + Math.round(this.look.line * 0.78);
    for (const { piece, x, s, cut } of this.line) {
      const image = cut && piece.hyphen ? cropRight(piece.image, piece.hyphen) : piece.image;
      drawScaled(this.screen, image, x, base - Math.round(piece.baseline * s), s);
    }
    this.used = true;
    this.y += this.pitch;
    this.line = [];
    this.lineX = this.look.margin;
  }

  async add(p: Piece) {
    if (p.kind === "block") {
      await this.flushLine();
      const maxH = this.look.height - 2 * this.look.margin;
      const s = Math.min(this.s, this.usable / p.image.width, maxH / p.image.height);
      const w = Math.round(p.image.width * s);
      const h = Math.round(p.image.height * s);
      const gap = Math.round(this.look.line * 0.4);
      if (this.y + gap + h > this.look.height - this.look.margin) await this.newScreen();
      if (!this.used) this.firstPage = p.page;
      const top = this.used ? this.y + gap : this.y;
      drawScaled(this.screen, p.image, this.look.margin + Math.round((this.usable - w) / 2), top, s);
      this.used = true;
      this.y = top + h + gap;
      return;
    }
    if (p.starts && this.line.length) {
      await this.flushLine();
      this.y += Math.round(this.look.line * 0.45);
    }
    const s = Math.min(this.s, this.usable / p.image.width);
    const w = Math.round(p.image.width * s);
    const space = Math.round(this.look.line * 0.33);
    // The rest of a word split by a hyphen: joined to its first part when both fit on the line.
    const last = this.line[this.line.length - 1];
    if (last?.piece.hyphen && !p.starts) {
      const joinAt = last.x + Math.round((last.piece.image.width - last.piece.hyphen) * last.s);
      if (joinAt + w <= this.look.width - this.look.margin) {
        last.cut = true;
        this.line.push({ piece: p, x: joinAt, s });
        this.lineX = joinAt + w;
        return;
      }
    }
    let x = this.line.length ? this.lineX + space : this.look.margin + (p.starts ? Math.round(this.look.line * 0.9) : 0);
    if (x + w > this.look.width - this.look.margin && this.line.length) {
      await this.flushLine();
      x = this.look.margin;
    }
    this.line.push({ piece: p, x, s });
    this.lineX = x + w;
  }

  async finish() {
    await this.flushLine();
    await this.newScreen();
  }
}
