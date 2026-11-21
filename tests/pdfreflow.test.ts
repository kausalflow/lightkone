import { describe, expect, it } from "vitest";
import { columns, cutPage, inkBox, Layout, runs, textArea, trailingHyphen, type GreyImage } from "../src/core/pdfreflow";
import { paperEpub } from "../src/core/ereader";
import type { Paper } from "../src/core/types";

const W = 2550;
const H = 3300;
const page = (): GreyImage => ({ width: W, height: H, grey: new Uint8Array(W * H).fill(255) });
const fill = (img: GreyImage, x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y < y1; y++) img.grey.fill(0, y * img.width + x0, y * img.width + x1);
};

/** Lines of "words" (black bars 30 px high, 14 px gaps between letters' bars, 30 px between words). */
function text(img: GreyImage, x0: number, x1: number, y0: number, lines: number, indentFirst = 0): number {
  let y = y0;
  for (let l = 0; l < lines; l++) {
    let x = x0 + (l === 0 ? indentFirst : 0);
    while (x + 100 < x1) {
      fill(img, x, y, x + 100, y + 30);
      x += 130;
    }
    y += 42;
  }
  return y;
}

describe("cutting a PDF page", () => {
  it("finds runs of ink, joining small gaps", () => {
    expect(runs([0, 1, 1, 0, 1, 0, 0, 0, 1])).toEqual([
      [1, 3],
      [4, 5],
      [8, 9],
    ]);
    expect(runs([0, 1, 1, 0, 1, 0, 0, 0, 1], 2)).toEqual([
      [1, 5],
      [8, 9],
    ]);
  });

  it("splits a two-column band at its gutter", () => {
    const img = page();
    text(img, 300, 1220, 400, 10);
    text(img, 1330, 2250, 400, 10);
    const band = inkBox(img)!;
    const cols = columns(img, band, 40);
    expect(cols).toHaveLength(2);
    expect(cols[0].x1).toBeLessThanOrEqual(1330);
    expect(cols[1].x0).toBeGreaterThanOrEqual(1220);
  });

  it("leaves out arXiv's sideways stamp in the margin", () => {
    const img = page();
    text(img, 400, 2200, 400, 20);
    fill(img, 60, 800, 100, 2400);
    const area = textArea(img)!;
    expect(area.x0).toBeGreaterThanOrEqual(400);
  });

  it("reads the left column before the right, word by word", () => {
    const img = page();
    text(img, 300, 1220, 400, 6, 60);
    text(img, 1330, 2250, 400, 6);
    const { pieces, textLine } = cutPage(img, 1);
    expect(textLine).toBe(30);
    expect(pieces.every((p) => p.kind === "word")).toBe(true);
    // One paragraph start, then 41 words on the left (its indented first line has one fewer) and 42 on the right.
    expect(pieces.filter((p) => p.starts)).toHaveLength(1);
    expect(pieces).toHaveLength(41 + 42);
  });

  it("keeps a figure whole", () => {
    const img = page();
    const y = text(img, 300, 2250, 300, 4);
    fill(img, 800, y + 80, 1700, y + 700);
    for (let x = 820; x < 1680; x += 4) fill(img, x, y + 100, x + 2, y + 680);
    text(img, 300, 2250, y + 800, 3);
    const { pieces } = cutPage(img, 1);
    const blocks = pieces.filter((p) => p.kind === "block");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].image.width).toBe(900);
    expect(pieces.filter((p) => p.kind === "word" && p.starts)).toHaveLength(2);
  });

  it("drops a page number at the foot", () => {
    const img = page();
    text(img, 300, 2250, 300, 10);
    fill(img, 1260, 3100, 1290, 3130);
    const { pieces } = cutPage(img, 1);
    expect(pieces.every((p) => p.image.width === 100)).toBe(true);
  });

  it("knows a hyphen at a word's end", () => {
    const img = page();
    fill(img, 100, 100, 200, 130); // letters, baseline at 130
    fill(img, 206, 112, 216, 116); // a dash at mid height
    expect(trailingHyphen(img, { x0: 100, y0: 100, x1: 216, y1: 130 }, 30, 30)).toBe(16);
    fill(img, 300, 100, 400, 130);
    fill(img, 406, 100, 416, 130); // a tall letter, not a dash
    expect(trailingHyphen(img, { x0: 300, y0: 100, x1: 416, y1: 130 }, 30, 30)).toBe(0);
  });
});

describe("laying out screens", () => {
  it("fills screens line by line at the chosen text size", async () => {
    const img = page();
    text(img, 300, 2250, 300, 60);
    const { pieces, textLine } = cutPage(img, 3);
    const screens: { first: number; screen: GreyImage }[] = [];
    const layout = new Layout({ width: 480, height: 760, margin: 10, line: 26 }, (screen, first) => {
      screens.push({ first, screen: { ...screen, grey: screen.grey.slice() } });
    });
    layout.setTextLine(textLine);
    for (const p of pieces) await layout.add(p);
    await layout.finish();
    expect(screens.length).toBeGreaterThan(3);
    expect(screens[0].first).toBe(3);
    const s = screens[0].screen;
    expect(s.width).toBe(480);
    // Ink inside the margins only.
    const box = inkBox(s)!;
    expect(box.x0).toBeGreaterThanOrEqual(10);
    expect(box.x1).toBeLessThanOrEqual(470);
    // Words were scaled from 30 px to 26 px high.
    expect(runs(Array.from({ length: s.height }, (_, y) => (s.grey[y * s.width + box.x0 + 2] < 128 ? 1 : 0)))[0]).toEqual([expect.any(Number), expect.any(Number)]);
  });
});

describe("a PDF-only paper as an EPUB", () => {
  it("re-flows the PDF's pages when there is no HTML version", async () => {
    const p: Paper = { id: "p9", key: "X", type: "article", title: "Only a PDF", authors: ["Doe, Jane"], tags: [], folders: [], pdf: "papers/x.pdf", added: "", updated: "" } as unknown as Paper;
    const made = await paperEpub(p, {
      page: async () => {
        throw new Error("no");
      },
      file: async () => ({ bytes: new Uint8Array(), type: "" }),
      math: async () => {
        throw new Error("no");
      },
      picture: async () => null,
      parse: () => {
        throw new Error("no");
      },
      pdf: async () => new Uint8Array([1]),
      async pdfPages(_bytes, each) {
        for (let n = 1; n <= 2; n++) {
          const img = page();
          text(img, 300, 2250, 300, 40, 60);
          await each(img, n, 2);
        }
      },
    });
    expect(made.source).toBe("pdf");
    expect(made.pages).toBe(2);
    expect(made.screens).toBeGreaterThan(2);
    const text8 = new TextDecoder().decode(made.bytes);
    expect(text8).toContain("images/s001.png");
  });
});
