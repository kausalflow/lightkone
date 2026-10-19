// Adding a paper from outside the app: Android's share menu (the installed app
// is a share target, so Lightkone opens with ?title=&text=&url=) and the
// bookmarklet (?add=<DOI, arXiv id or page link>).

const DOI = /10\.\d{4,9}\/[^\s"<>]+/;
const ARXIV = /arxiv\.org\/(?:abs|pdf|html)\/[^\s"<>]+|arxiv:\s*\S+/i;
const LINK = /https?:\/\/[^\s"<>]+/;

/** What to look up, taken from the page's query string, or null when nothing was shared. */
export function capturedInput(search: string): string | null {
  const q = new URLSearchParams(search);
  if (q.get("add")?.trim()) return q.get("add")!.trim();
  const shared = ["url", "text", "title"].map((k) => q.get(k) ?? "").join("\n").trim();
  if (!shared) return null;
  // Prefer an identifier anywhere in what was shared, then the first link.
  return shared.match(ARXIV)?.[0] ?? shared.match(DOI)?.[0].replace(/[.,;)]+$/, "") ?? shared.match(LINK)?.[0] ?? shared.split("\n")[0];
}

/** The query keys capture uses, to clear them from the address bar afterwards. */
export const CAPTURE_KEYS = ["add", "url", "text", "title"];

/**
 * A bookmarklet that reads the page's citation tags (most publishers and
 * arXiv have them) and opens Lightkone at `app` to add the paper.
 */
export function bookmarklet(app: string): string {
  const code = `(()=>{const m=n=>{const e=document.querySelector('meta[name="'+n+'" i]');return e&&e.content.trim()};const a=m('citation_arxiv_id');const v=m('citation_doi')||(a&&'arXiv:'+a)||((d)=>d&&/10\\.\\d/.test(d)&&d)(m('dc.identifier'))||location.href;open(${JSON.stringify(app)}+'?add='+encodeURIComponent(v))})()`;
  return `javascript:${encodeURI(code)}`;
}

// PDF files shared to the installed app arrive as a POST, which a static site
// can't receive, so the service worker (public/sw.js) keeps them in this cache
// and opens the app with ?shared-files.
export const SHARED_FILES_KEY = "shared-files";
const SHARED_CACHE = "lightkone-shared";

export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** The PDFs the service worker kept from a share, removed from its cache as they are taken. */
export async function takeSharedFiles(): Promise<File[]> {
  if (!("caches" in self)) return [];
  const cache = await caches.open(SHARED_CACHE);
  const files: File[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res) files.push(new File([await res.blob()], decodeURIComponent(res.headers.get("x-name") ?? "shared.pdf"), { type: "application/pdf" }));
    await cache.delete(req);
  }
  return files;
}
