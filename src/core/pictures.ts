import { PICTURE_WIDTH, type Picture } from "./ereader";

// Pictures for e-ink readers, drawn in the browser: equations (MathML drawn by
// MathJax as SVG, then onto a canvas) and figures, all in shades of grey at
// the size they will show on a 480-pixel-wide screen. MathJax loads only when
// a paper is first sent, so it costs nothing otherwise.

/** Pixels per ex (the height of an "x"): text on small readers is about 19 px, whose x is about 8.5 px high. */
export const EX = 8.5;
/** The tallest a figure may be: a 800-pixel screen less margins and a caption line. */
const PICTURE_HEIGHT = 640;
/** Display equations wider than the screen are shrunk, but not below this, so they stay readable. */
const MIN_SCALE = 0.6;

// ---------------------------------------------------------------- grey PNG

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A PNG of 8-bit grey pixels (one byte each, 0 black to 255 white), row by row. */
export async function greyPng(width: number, height: number, grey: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // no filter
    raw.set(grey.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", await zlib(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

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

async function drawSvg(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const sized = svg
    .replace(/\swidth="[\d.]+ex"/, ` width="${width}"`)
    .replace(/\sheight="[\d.]+ex"/, ` height="${height}"`)
    .replace(/currentColor/g, "#000");
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
  return greyPng(canvas.width, canvas.height, toGrey(data));
}

/** An equation as a picture for the screen, in the browser. */
export async function mathPicture(mathml: string, display: boolean, type: Picture["type"] = "image/png"): Promise<Picture> {
  const svg = await mathSvg(mathml, display);
  const size = svgSize(svg);
  if (!size) throw new Error("MathJax gave no size");
  let scale = EX;
  if (display && size.width * scale > PICTURE_WIDTH) scale = Math.max(EX * MIN_SCALE, PICTURE_WIDTH / size.width);
  const width = Math.max(1, Math.ceil(size.width * scale));
  const height = Math.max(1, Math.ceil(size.height * scale));
  const canvas = await drawSvg(svg, width, height);
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
