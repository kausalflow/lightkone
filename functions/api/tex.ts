// Cloudflare Pages Function at /api/tex?arxiv=<id>
//
// The displayed equations of an arXiv paper, from its LaTeX source: arXiv's
// e-print is a gzipped tar of the source, a single gzipped .tex, or a PDF when
// no source was given. Browsers cannot fetch it, hence this pass-through; the
// answer is cached for a week at the edge. Answers { arxiv, equations }.

import { extractEquations } from "../../src/core/equations";

const ID = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i;
const LARGEST = 40 * 1024 * 1024;

const json = (status: number, body: unknown, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...(maxAge ? { "cache-control": `public, max-age=${maxAge}` } : {}) },
  });

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files of a tar archive, by name. */
export function untar(tar: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const text = (a: number, b: number) => new TextDecoder().decode(tar.subarray(a, b)).replace(/\0.*$/s, "");
  for (let at = 0; at + 512 <= tar.length; ) {
    const name = text(at, at + 100);
    if (!name) break;
    const size = parseInt(text(at + 124, at + 136).trim() || "0", 8);
    const type = text(at + 156, at + 157);
    const prefix = text(at + 257, at + 263).startsWith("ustar") ? text(at + 345, at + 500) : "";
    if (type === "0" || type === "") out.set(prefix ? `${prefix}/${name}` : name, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

const isTar = (b: Uint8Array) => b.length > 262 && new TextDecoder().decode(b.subarray(257, 262)) === "ustar";

/** The LaTeX in an e-print, every .tex file of it joined. */
export async function sourceOf(bytes: Uint8Array): Promise<string> {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") return "";
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzip(bytes) : bytes;
  if (isTar(raw)) {
    return [...untar(raw)]
      .filter(([name]) => /\.(tex|ltx)$/i.test(name))
      .map(([, b]) => new TextDecoder().decode(b))
      .join("\n");
  }
  const text = new TextDecoder().decode(raw);
  // A single .tex file, LaTeX or plain TeX; anything else (a PostScript file, say) has no equations to give.
  return !text.includes("\0") && /\\(documentclass|begin|section|input|def|eqn)\b/.test(text) ? text : "";
}

export async function handle(request: Request, f: typeof fetch = fetch): Promise<Response> {
  const arxiv = (new URL(request.url).searchParams.get("arxiv") ?? "").trim();
  if (!ID.test(arxiv)) return json(400, { error: "Pass an arXiv id as ?arxiv=1706.03762" });
  const r = await f(`https://arxiv.org/e-print/${arxiv}`, { headers: { "user-agent": "Lightkone (equation search)" } });
  if (r.status === 404) return json(404, { error: "arXiv has no such paper." });
  if (!r.ok) return json(r.status === 429 ? 429 : 502, { error: `arXiv answered ${r.status}.` });
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > LARGEST) return json(200, { arxiv, equations: [] }, 604800);
  return json(200, { arxiv, equations: extractEquations(await sourceOf(bytes)) }, 604800);
}

export const onRequestGet = async ({ request, waitUntil }: { request: Request; waitUntil(p: Promise<unknown>): void }) => {
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const hit = await cache?.match(request);
  if (hit) return hit;
  const res = await handle(request);
  if (cache && res.ok) waitUntil(cache.put(request, res.clone()));
  return res;
};
