import type { Attachment, Paper } from "./types";
import { site } from "./site";
import { isPdf } from "./openpdf";
import { paperpileFile, PDF_DIR } from "./filing";

// Files from the web: a PDF link pasted or shared to Lightkone, a paper's page
// that links its PDF, a supplement or dataset attached from a link. The bytes
// come through the site's small file service (functions/api/file.ts), since
// browsers don't let one site download another's files.

export interface RemoteFile {
  bytes: Uint8Array;
  /** The type the site gave, e.g. "application/pdf" or "text/html". */
  type: string;
  name: string;
  /** The address it was finally fetched from, after redirects. */
  url: string;
}

/** A link that names a PDF by its address: ends in .pdf, or a /pdf/ path as arXiv and many publishers use. */
export const isPdfLink = (s: string) => /^https?:\/\/\S+$/i.test(s.trim()) && (/\.pdf([?#]|$)/i.test(s.trim()) || /\/(pdf|epdf|pdfdirect)\//i.test(s.trim()));

/** The file behind a link. Throws with the service's reason when it can't be had. */
export async function fetchFile(url: string, f: typeof fetch = fetch.bind(globalThis)): Promise<RemoteFile> {
  let r: Response;
  try {
    r = await f(site(`api/file?url=${encodeURIComponent(url.trim())}`));
  } catch {
    throw new Error("Lightkone's file service can't be reached. Are you offline?");
  }
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? (r.status === 404 ? "This copy of Lightkone has no file service (it runs on Cloudflare Pages)." : `The file service failed (${r.status}).`));
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  let name = "";
  try {
    name = decodeURIComponent(r.headers.get("x-file-name") ?? "");
  } catch {
    // keep it empty
  }
  const type = isPdf(bytes) ? "application/pdf" : r.headers.get("x-file-type") ?? "application/octet-stream";
  const from = r.headers.get("x-file-url") ?? url;
  if (type === "application/pdf" && name && !/\.pdf$/i.test(name)) name += ".pdf";
  return { bytes, type, name: name || "file", url: from };
}

/** Where a page says its PDF is: the citation_pdf_url tag publishers put there for Google Scholar, else a PDF link it carries. */
export function pdfLinkIn(doc: Document, base: string): string | null {
  const abs = (href: string | null | undefined) => {
    if (!href) return null;
    try {
      const u = new URL(href, base);
      return /^https?:$/.test(u.protocol) ? u.href : null;
    } catch {
      return null;
    }
  };
  const meta = doc.querySelector('meta[name="citation_pdf_url" i], meta[property="citation_pdf_url" i]')?.getAttribute("content");
  if (abs(meta)) return abs(meta);
  const alt = doc.querySelector('link[type="application/pdf"]')?.getAttribute("href");
  if (abs(alt)) return abs(alt);
  const links = [...doc.querySelectorAll("a[href]")].map((a) => abs(a.getAttribute("href"))).filter((u): u is string => Boolean(u && /\.pdf([?#]|$)/i.test(u)));
  // Only a page with one PDF on it says clearly which is the paper's.
  return new Set(links).size === 1 ? links[0] : null;
}

/**
 * The PDF behind a link: the file itself, or, for a page, the PDF the page names.
 * Throws when there is none to be had.
 */
export async function fetchPdf(url: string, f: typeof fetch = fetch.bind(globalThis)): Promise<RemoteFile> {
  const file = await fetchFile(url, f);
  if (file.type === "application/pdf") return file;
  if (/html|xml/.test(file.type)) {
    const html = new TextDecoder().decode(file.bytes);
    const link = pdfLinkIn(new DOMParser().parseFromString(html, "text/html"), file.url);
    if (link && link !== file.url) {
      const pdf = await fetchFile(link, f);
      if (pdf.type === "application/pdf") return pdf;
      throw new Error(`The page links a PDF, but ${new URL(link).hostname} handed back a page instead (it may need you to be signed in).`);
    }
    throw new Error("That link is a web page with no PDF on it that Lightkone could find.");
  }
  throw new Error(`That link is not a PDF (it is ${file.type}).`);
}

// A paper looked up from its page remembers the PDF that page links, so the
// PDF can be fetched once the paper is in the library, when no open copy is found.
const pagePdfs = new Map<string, string>();

/** Remember the PDF a looked-up page links, under each of the paper's names (its link, DOI, arXiv id). */
export function rememberPdfLink(keys: (string | undefined)[], link: string): void {
  for (const k of keys) if (k) pagePdfs.set(k.toLowerCase(), link);
  while (pagePdfs.size > 30) pagePdfs.delete(pagePdfs.keys().next().value!);
}

/** The PDF link a page of this paper named a moment ago, if any. */
export function pdfLinkFor(p: Pick<Paper, "url" | "doi" | "arxiv">): string | null {
  for (const k of [p.url, p.doi, p.arxiv]) {
    const link = k && pagePdfs.get(k.toLowerCase());
    if (link) return link;
  }
  return null;
}

// ---------------------------------------------------------------- attachments

/** File name characters storage and Drive both accept. */
const cleanName = (s: string) => s.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "file";

/**
 * Where a further file of this paper goes: next to its PDF, named after it,
 * "All Papers/HINTON/Hinton et al. 2012 - Improving ... - supplement.pdf".
 * A name already taken gets " (2)", " (3)" ...
 */
export function attachmentPath(p: Paper, name: string, library: Paper[]): string {
  const base = p.pdf ? p.pdf.replace(/\.pdf$/i, "") : PDF_DIR + paperpileFile(p).replace(/\.pdf$/, "");
  const file = cleanName(name);
  const dot = file.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ""];
  const taken = new Set(library.flatMap((q) => [q.pdf, ...(q.attachments ?? []).map((a) => a.path)]));
  let path = `${base} - ${stem}${ext}`;
  for (let i = 2; taken.has(path); i++) path = `${base} - ${stem} (${i})${ext}`;
  return path;
}

/** A file kept with a paper, as the library records it. */
export function attachment(path: string, name: string, bytes: Uint8Array, type?: string, from?: string): Attachment {
  return { path, name: cleanName(name), type: type || undefined, size: bytes.length, ...(from ? { from } : {}), added: new Date().toISOString() };
}

/** "2.1 MB", "640 KB". */
export function sizeLabel(n?: number): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const TYPES: Record<string, string> = {
  pdf: "application/pdf", csv: "text/csv", txt: "text/plain", md: "text/markdown", json: "application/json", zip: "application/zip",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", mp4: "video/mp4",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", tex: "text/x-tex", bib: "text/x-bibtex", ipynb: "application/x-ipynb+json",
};

/** A type for a file that came without one, from its name. */
export const typeOf = (name: string, given?: string) => (given && given !== "application/octet-stream" ? given : TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream");
