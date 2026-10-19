import type { Paper } from "./types";
import { site } from "./site";

// Finding a free PDF for a paper. arXiv allows browser requests, so its PDFs
// are fetched directly. For a DOI, the site's small PDF service
// (functions/api/pdf.ts) asks Unpaywall for an open-access copy and fetches it,
// since publishers do not allow browser requests.

export interface OpenPdfOptions {
  /** URL of the PDF service; relative to the site by default. Empty turns DOIs off. */
  service?: string;
  /** Contact email Unpaywall asks for. Without it, only arXiv PDFs are fetched. */
  email?: string;
  fetch?: typeof fetch;
}

const MAX_BYTES = 80 * 1024 * 1024;

export const isPdf = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF

async function get(f: typeof fetch, url: string): Promise<Uint8Array | null> {
  const r = await f(url);
  if (!r.ok) return null;
  if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
  const bytes = new Uint8Array(await r.arrayBuffer());
  return isPdf(bytes) ? bytes : null;
}

export function canFindOpenPdf(p: Pick<Paper, "arxiv" | "doi">, opts: OpenPdfOptions): boolean {
  return Boolean(p.arxiv || (p.doi && opts.email && opts.service !== ""));
}

/** The PDF's bytes, or null when no free copy was found. */
export async function findOpenPdf(p: Pick<Paper, "arxiv" | "doi">, opts: OpenPdfOptions = {}): Promise<Uint8Array | null> {
  const f = opts.fetch ?? fetch.bind(globalThis);
  if (p.arxiv) {
    const bytes = await get(f, `https://arxiv.org/pdf/${p.arxiv}`).catch(() => null);
    if (bytes) return bytes;
  }
  if (p.doi && opts.email && opts.service !== "") {
    const q = new URLSearchParams({ doi: p.doi, email: opts.email });
    return get(f, site(`${opts.service || "api/pdf"}?${q}`)).catch(() => null);
  }
  return null;
}
