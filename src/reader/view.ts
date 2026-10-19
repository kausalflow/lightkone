import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Highlight, Rect } from "../core/annotations";
import { guardSelection, unguardSelection } from "./selection";

// Draws a PDF as a column of pages: a canvas for the picture, pdf.js's text
// layer on top so text can be selected, and our highlights above that. Pages
// are drawn only when they come near the screen, so long papers open quickly.

// The legacy build carries polyfills for browsers a few versions old (pdf.js 6
// uses very new JavaScript such as Map.getOrInsertComputed).
let pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;

async function loadPdfjs() {
  if (!pdfjs) {
    const [lib, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    pdfjs = lib;
  }
  return pdfjs;
}

/**
 * Dark pages: swaps light and dark in place but keeps each colour's hue, so
 * black text turns white and a red curve stays red. Doing it twice restores the
 * page. This is done on the pixels rather than with a CSS filter, because some
 * phones (Chrome on Android) draw a filtered canvas as a blank page.
 */
export function invertLightness(px: Uint8ClampedArray) {
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const shift = 255 - Math.max(r, g, b) - Math.min(r, g, b);
    px[i] = r + shift;
    px[i + 1] = g + shift;
    px[i + 2] = b + shift;
  }
}

function invertCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx || !canvas.width || !canvas.height) return;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  invertLightness(img.data);
  ctx.putImageData(img, 0, 0);
}

/** The text of every page of a PDF, without drawing it. */
export async function extractText(bytes: Uint8Array): Promise<string[]> {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : "") : "")).join(""));
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

interface PageSlot {
  n: number;
  el: HTMLDivElement;
  marks: HTMLDivElement;
  width: number; // at scale 1, in PDF points
  height: number;
  drawn: number; // the width it was drawn at, 0 when not drawn
}

export interface Selected {
  page: number;
  rects: Rect[];
  text: string;
}

export class PdfView {
  private doc: PDFDocumentProxy | null = null;
  private pages: PageSlot[] = [];
  private observer: IntersectionObserver;
  private highlights: Highlight[] = [];
  zoom = 1;
  private dark = false;
  onHighlightClick: (h: Highlight) => void = () => {};

  constructor(private root: HTMLElement) {
    this.observer = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && this.draw(this.slotOf(e.target))), {
      root,
      rootMargin: "150% 0px",
    });
    this.pinch();
  }

  async open(bytes: Uint8Array): Promise<number> {
    const lib = await loadPdfjs();
    // pdf.js takes ownership of the buffer it is given, so hand it a copy.
    this.doc = await lib.getDocument({ data: bytes.slice() }).promise;
    for (let n = 1; n <= this.doc.numPages; n++) {
      const page = await this.doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const el = document.createElement("div");
      el.className = "pdf-page";
      el.dataset.page = String(n);
      const marks = document.createElement("div");
      marks.className = "pdf-marks";
      el.append(marks);
      this.root.append(el);
      this.pages.push({ n, el, marks, width: vp.width, height: vp.height, drawn: 0 });
    }
    this.layout();
    this.pages.forEach((s) => this.observer.observe(s.el));
    return this.doc.numPages;
  }

  private slotOf(el: Element): PageSlot {
    return this.pages[Number((el as HTMLElement).dataset.page) - 1];
  }

  private targetWidth(): number {
    return Math.min(this.root.clientWidth - 16, 1100) * this.zoom;
  }

  /** Size every page box for the current width; drawn pages are redrawn when seen. */
  layout() {
    const w = this.targetWidth();
    for (const s of this.pages) {
      s.el.style.width = `${w}px`;
      s.el.style.height = `${(w * s.height) / s.width}px`;
      if (s.drawn && Math.abs(s.drawn - w) > 1) {
        s.drawn = 0;
        this.draw(s);
      }
    }
  }

  /** Zooms the pages, keeping the point under (x, y) on screen; the middle of the view by default. */
  setZoom(z: number, x?: number, y?: number) {
    const box = this.root.getBoundingClientRect();
    const fx = (x ?? box.left + box.width / 2) - box.left;
    const fy = (y ?? box.top + box.height / 2) - box.top;
    const cx = this.root.scrollLeft + fx;
    const cy = this.root.scrollTop + fy;
    const before = this.zoom;
    this.zoom = Math.min(4, Math.max(0.5, z));
    this.layout();
    const r = this.zoom / before;
    this.root.scrollLeft = cx * r - fx;
    this.root.scrollTop = cy * r - fy;
  }

  // Pinching zooms the pages, not the whole app (the page itself sets
  // touch-action so the browser leaves pinches to us). While the fingers move
  // the pages are only stretched; they are drawn sharp at the new size on release.
  private pinch() {
    let start = 0;
    let mid: [number, number] = [0, 0];
    let scale = 1;
    const gap = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const end = () => {
      if (!start) return;
      start = 0;
      this.root.style.transform = "";
      if (Math.abs(scale - 1) > 0.02) this.setZoom(this.zoom * scale, mid[0], mid[1]);
    };
    this.root.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 2) return end();
      start = gap(e.touches);
      scale = 1;
      mid = [(e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2];
      const box = this.root.getBoundingClientRect();
      this.root.style.transformOrigin = `${mid[0] - box.left}px ${mid[1] - box.top}px`;
    }, { passive: true });
    this.root.addEventListener("touchmove", (e) => {
      if (!start || e.touches.length !== 2) return;
      scale = Math.min(4 / this.zoom, Math.max(0.5 / this.zoom, gap(e.touches) / start));
      this.root.style.transform = `scale(${scale})`;
    }, { passive: true });
    this.root.addEventListener("touchend", end);
    this.root.addEventListener("touchcancel", end);
  }

  /** Dark pages on or off; pages already drawn are flipped in place. */
  setDark(dark: boolean) {
    if (dark === this.dark) return;
    this.dark = dark;
    this.pages.forEach((s) => {
      const canvas = s.el.querySelector("canvas");
      if (canvas) invertCanvas(canvas);
    });
  }

  private async draw(s: PageSlot) {
    if (!this.doc || !pdfjs) return;
    const w = this.targetWidth();
    if (s.drawn === w) return;
    s.drawn = w;
    const page: PDFPageProxy = await this.doc.getPage(s.n);
    const scale = w / s.width;
    const viewport = page.getViewport({ scale });
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    const text = document.createElement("div");
    text.className = "textLayer";
    s.el.style.setProperty("--total-scale-factor", String(scale));
    s.el.style.setProperty("--scale-factor", String(scale));
    await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
    if (s.drawn !== w) return; // zoomed meanwhile
    if (this.dark) invertCanvas(canvas);
    s.el.querySelectorAll<HTMLElement>("canvas, .textLayer").forEach((x) => {
      unguardSelection(x);
      x.remove();
    });
    s.el.prepend(canvas, text);
    await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport }).render();
    guardSelection(text);
    this.paint(s);
  }

  setHighlights(hs: Highlight[]) {
    this.highlights = hs;
    this.pages.forEach((s) => this.paint(s));
  }

  private paint(s: PageSlot) {
    s.marks.replaceChildren(
      ...this.highlights
        .filter((h) => h.page === s.n)
        .flatMap((h) =>
          h.rects.map(([x, y, w, hh]) => {
            const m = document.createElement("button");
            m.className = `pdf-mark${h.note ? " noted" : ""}`;
            m.title = h.note || "Highlight";
            Object.assign(m.style, { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${hh * 100}%` });
            m.onclick = (e) => {
              e.stopPropagation();
              this.onHighlightClick(h);
            };
            return m;
          }),
        ),
    );
  }

  /** The current text selection inside one page, as page fractions. */
  selection(): Selected | null {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const text = sel.toString().replace(/\s+\n/g, "\n").trim();
    if (!text) return null;
    const range = sel.getRangeAt(0);
    const start = (range.startContainer.parentElement ?? range.startContainer) as Element;
    const pageEl = start.closest?.(".pdf-page") as HTMLElement | null;
    if (!pageEl || !this.root.contains(pageEl)) return null;
    const box = pageEl.getBoundingClientRect();
    // Boxes of the selected characters only, one per piece of text: the boxes
    // of whole elements that getClientRects() adds are taller than the line.
    const rects: Rect[] = [];
    for (const t of textNodesIn(range)) {
      if (t.parentElement?.closest(".pdf-page") !== pageEl || t.parentElement.closest(".endOfContent")) continue;
      const part = document.createRange();
      part.setStart(t, t === range.startContainer ? range.startOffset : 0);
      part.setEnd(t, t === range.endContainer ? range.endOffset : t.length);
      if (!part.toString().trim()) continue;
      const r = part.getBoundingClientRect();
      if (r.width > 1 && r.height > 1 && r.top < box.bottom && r.bottom > box.top) {
        rects.push([(r.left - box.left) / box.width, (r.top - box.top) / box.height, r.width / box.width, r.height / box.height]);
      }
    }
    return rects.length ? { page: Number(pageEl.dataset.page), rects, text } : null;
  }

  /** The text of every page, as pdf.js reads it. */
  async allText(): Promise<string[]> {
    if (!this.doc) return [];
    const pages: string[] = [];
    for (let n = 1; n <= this.doc.numPages; n++) {
      const content = await (await this.doc.getPage(n)).getTextContent();
      pages.push(content.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : "") : "")).join(""));
    }
    return pages;
  }

  /** A PNG (base64) of part of a drawn page, around the given boxes, so Claude sees equations as typeset. */
  snapshot(page: number, rects: Rect[]): string | null {
    const canvas = this.pages[page - 1]?.el.querySelector("canvas");
    if (!canvas || !rects.length) return null;
    const x0 = Math.max(0, Math.min(...rects.map((r) => r[0])) - 0.02);
    const y0 = Math.max(0, Math.min(...rects.map((r) => r[1])) - 0.02);
    const x1 = Math.min(1, Math.max(...rects.map((r) => r[0] + r[2])) + 0.02);
    const y1 = Math.min(1, Math.max(...rects.map((r) => r[1] + r[3])) + 0.02);
    const sw = (x1 - x0) * canvas.width;
    const sh = (y1 - y0) * canvas.height;
    const k = Math.min(1, 1400 / sw, 1400 / sh);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(sw * k));
    out.height = Math.max(1, Math.round(sh * k));
    out.getContext("2d")!.drawImage(canvas, x0 * canvas.width, y0 * canvas.height, sw, sh, 0, 0, out.width, out.height);
    if (this.dark) invertCanvas(out); // Claude sees the page as printed
    return out.toDataURL("image/png").split(",")[1] ?? null;
  }

  scrollToPage(page: number) {
    const s = this.pages[page - 1];
    if (s) this.root.scrollTop = s.el.offsetTop - 8;
  }

  scrollTo(h: Highlight) {
    const s = this.pages[h.page - 1];
    if (!s) return;
    this.root.scrollTop = s.el.offsetTop + (h.rects[0]?.[1] ?? 0) * s.el.offsetHeight - 80;
  }

  destroy() {
    this.observer.disconnect();
    this.root.querySelectorAll<HTMLElement>(".textLayer").forEach(unguardSelection);
    this.doc?.loadingTask.destroy();
    this.root.replaceChildren();
  }
}

/** The text nodes a range touches, in order. */
function textNodesIn(range: Range): Text[] {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return [root as Text];
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (range.intersectsNode(n)) out.push(n as Text);
  return out;
}
