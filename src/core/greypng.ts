// Grey pictures as PNG files, with no browser canvas needed.


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

/**
 * Pushes greys toward black, so antialiased edges of thin lines don't turn
 * faint when an e-ink screen dithers them to its few levels. White stays white.
 * With levels (16 is what e-ink shows), greys are rounded to that many, which
 * makes the PNG much smaller.
 */
export function darken(grey: Uint8Array, levels = 256): Uint8Array {
  const table = new Uint8Array(256);
  const step = 255 / (levels - 1);
  for (let v = 0; v < 256; v++) table[v] = Math.round(Math.round((255 * Math.pow(v / 255, 2.4)) / step) * step);
  const out = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i++) out[i] = table[grey[i]];
  return out;
}

