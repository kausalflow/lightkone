// Cloudflare Pages Function at /api/page?url=<web page>
//
// Saving a web page into the library: browsers don't let one site read
// another's pages, so this fetches the page and hands its HTML back to the app.
// It answers JSON, never HTML, so nothing fetched can run as part of this site,
// and it only fetches public http(s) pages on the usual ports, so it cannot be
// used to reach private addresses. /api/_middleware.ts limits how often.

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" },
  });

/** True for a public http(s) address on the default port; false for local or private ones. */
export function isPublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.port || u.username || u.password) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /\.(local|localhost|internal|lan|home|arpa)$/.test(host)) return false;
  // Addresses written as numbers are refused: pages have names.
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return false;
  return true;
}

/** The charset a page declares, in its headers or its first bytes. */
export function charsetOf(contentType: string, head: string): string {
  const c = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try {
    new TextDecoder(c);
    return c;
  } catch {
    return "utf-8";
  }
}

export async function handle(request: Request, f: typeof fetch = fetch): Promise<Response> {
  let url = (new URL(request.url).searchParams.get("url") ?? "").trim();
  if (!isPublicUrl(url)) return json(400, { error: "Pass a public web page as ?url=https://..." });

  let r: Response | null = null;
  // Redirects are followed by hand, so each address is checked.
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    r = await f(url, {
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "user-agent": "Mozilla/5.0 (compatible; Lightkone; +https://lightkone.lab.kausalflow.com)",
      },
    });
    const next = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!next) break;
    url = new URL(next, url).href;
    if (!isPublicUrl(url)) return json(400, { error: "The page redirects to an address that can't be saved." });
    r = null;
  }
  if (!r) return json(502, { error: "Too many redirects." });
  if (!r.ok) return json(r.status === 404 ? 404 : 502, { error: `The site answered ${r.status}.` });
  const type = r.headers.get("content-type") ?? "";
  if (!/html|xml/i.test(type)) return json(415, { error: type.includes("pdf") ? "This link is a PDF: add it with Add PDF files." : "This link is not a web page." });
  if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) return json(413, { error: "The page is too big to save." });
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json(413, { error: "The page is too big to save." });
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const html = new TextDecoder(charsetOf(type, head)).decode(bytes);
  return json(200, { url, html });
}

export const onRequestGet = ({ request }: { request: Request }) => handle(request);
