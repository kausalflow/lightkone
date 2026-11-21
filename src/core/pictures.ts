import { PICTURE_WIDTH, type Picture } from "./ereader";
import { darken, greyPng } from "./greypng";

export { darken, greyPng };

// Pictures for e-ink readers, drawn in the browser: equations (MathML drawn by
// MathJax as SVG, then onto a canvas) and figures, all in shades of grey at
// the size they will show on a 480-pixel-wide screen. MathJax loads only when
// a paper is first sent, so it costs nothing otherwise.

/**
 * Pixels per ex (the height of an "x"). Small readers draw pictures at their
 * own pixel size, next to text that is large on a 220 ppi screen: the Xteink
 * X4's default text has an x about 13 px high.
 */
export const EX = 13;

/** How equations are drawn: their size, and how much their strokes are thickened. */
export interface MathLook {
  /** Pixels per ex. */
  ex?: number;
  /** Extra stroke width, in thousandths of an em, so thin lines survive an e-ink screen. */
  weight?: number;
}

/** The tallest a figure may be: a 800-pixel screen less margins and a caption line. */
const PICTURE_HEIGHT = 640;
/** Display equations wider than the screen are shrunk, but not below this, so they stay readable. */
const MIN_SCALE = 0.6;

/** Grey levels from canvas pixels, drawn over white. */
export function toGrey(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const a = rgba[i + 3] / 255;
    const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    out[j] = Math.round(lum * a + 255 * (1 - a));
  }
  return out;
}

// ---------------------------------------------------------------- equations

/** The size MathJax gives an SVG, in ex: width, height and how far it sits below the baseline. */
export function svgSize(svg: string): { width: number; height: number; depth: number } | null {
  const w = /\swidth="([\d.]+)ex"/.exec(svg)?.[1];
  const h = /\sheight="([\d.]+)ex"/.exec(svg)?.[1];
  const d = /vertical-align:\s*(-?[\d.]+)ex/.exec(svg)?.[1];
  if (!w || !h) return null;
  return { width: Number(w), height: Number(h), depth: d ? -Number(d) : 0 };
}

type ToSvg = (mathml: string, display: boolean) => string;
let mathjax: Promise<ToSvg> | null = null;

/** MathJax, set up once: MathML in, SVG out, with no shared font cache so each SVG stands alone. */
export function loadMathJax(): Promise<ToSvg> {
  mathjax ??= (async () => {
    const [{ mathjax: mj }, { MathML }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
      import("mathjax-full/js/mathjax.js"),
      import("mathjax-full/js/input/mathml.js"),
      import("mathjax-full/js/output/svg.js"),
      import("mathjax-full/js/adaptors/liteAdaptor.js"),
      import("mathjax-full/js/handlers/html.js"),
    ]);
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const doc = mj.document("", { InputJax: new MathML(), OutputJax: new SVG({ fontCache: "none" }) });
    return (mathml: string, display: boolean) => {
      const node = doc.convert(mathml, { display });
      const svg = adaptor.firstChild(node) as unknown;
      return adaptor.outerHTML(svg as never);
    };
  })();
  return mathjax;
}

/** The SVG MathJax draws for a MathML equation. */
export async function mathSvg(mathml: string, display: boolean): Promise<string> {
  const toSvg = await loadMathJax();
  const svg = toSvg(mathml, display);
  if (/data-mjx-error|merror/.test(svg)) throw new Error("MathJax couldn't read this equation");
  return svg;
}

/** The SVG at a pixel size, in black, with its strokes thickened by `weight` thousandths of an em. */
export function sizedSvg(svg: string, width: number, height: number, weight = 0): string {
  return svg
    .replace(/\swidth="[\d.]+ex"/, ` width="${width}"`)
    .replace(/\sheight="[\d.]+ex"/, ` height="${height}"`)
    .replace(/currentColor/g, "#000")
    .replace(/stroke-width="0"/g, `stroke-width="${weight}" stroke-linejoin="round"`);
}

async function drawSvg(svg: string, width: number, height: number, weight = 0): Promise<HTMLCanvasElement> {
  const sized = sizedSvg(svg, width, height, weight);
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "sync";
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error("The picture couldn't be drawn"));
      img.src = url;
    });
    return canvasOf(img, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasOf(img: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

async function encode(canvas: HTMLCanvasElement, type: Picture["type"]): Promise<Uint8Array> {
  if (type === "image/jpeg") {
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.88));
    if (!blob) throw new Error("The picture couldn't be saved");
    return new Uint8Array(await blob.arrayBuffer());
  }
  const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  return greyPng(canvas.width, canvas.height, darken(toGrey(data)));
}

/** An equation as a picture for the screen, in the browser. */
export async function mathPicture(mathml: string, display: boolean, type: Picture["type"] = "image/png", look: MathLook = {}): Promise<Picture> {
  const svg = await mathSvg(mathml, display);
  const size = svgSize(svg);
  if (!size) throw new Error("MathJax gave no size");
  const ex = look.ex ?? EX;
  let scale = ex;
  if (display && size.width * scale > PICTURE_WIDTH) scale = Math.max(ex * MIN_SCALE, PICTURE_WIDTH / size.width);
  const width = Math.max(1, Math.ceil(size.width * scale));
  const height = Math.max(1, Math.ceil(size.height * scale));
  const canvas = await drawSvg(svg, width, height, look.weight ?? 30);
  return { data: await encode(canvas, type), type, width, height, depth: Math.round(size.depth * scale) };
}

// ---------------------------------------------------------------- figures

/** The size a figure is shrunk to so it fits the screen; never enlarged. */
export function fitSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, PICTURE_WIDTH / width, PICTURE_HEIGHT / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** A figure (PNG, JPEG, GIF, WebP or SVG) shrunk to fit the screen, in grey. */
export async function figurePicture(bytes: Uint8Array, type: string, out: Picture["type"] = "image/png"): Promise<Picture | null> {
  const isSvg = /svg/.test(type) || /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(new TextDecoder().decode(bytes.subarray(0, 200)));
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  let url = "";
  try {
    if (isSvg) {
      url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/svg+xml" }));
      const img = new Image();
      await new Promise<void>((ok, fail) => {
        img.onload = () => ok();
        img.onerror = () => fail(new Error("unreadable"));
        img.src = url;
      });
      w = img.naturalWidth || 600;
      h = img.naturalHeight || 400;
      source = img;
    } else {
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: type || "image/png" }));
      w = bitmap.width;
      h = bitmap.height;
      source = bitmap;
    }
    const size = fitSize(w, h);
    const canvas = canvasOf(source, size.width, size.height);
    return { data: await encode(canvas, out), type: out, ...size };
  } catch {
    return null;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
