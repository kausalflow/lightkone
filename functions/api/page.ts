// Cloudflare Pages Function at /api/page?url=<web page>
//
// Saving a web page into the library: browsers don't let one site read
// another's pages, so this fetches the page and hands its HTML back to the app.
// It answers JSON, never HTML, so nothing fetched can run as part of this site,
// and it only fetches public http(s) pages on the usual ports, so it cannot be
// used to reach private addresses. /api/_middleware.ts limits how often.

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT = 15_000;

// When the site fails, the answer is 424, never 502 or 504: Cloudflare puts its
// own "error code: 502" page in place of those, and the app would lose the reason.
const FAILED = 424;

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

/** Why the site said no, in words; blocked is true when it turns away readers that aren't a person's browser. */
export function refusal(host: string, r: Response): { error: string; blocked?: true } {
  const s = r.status;
  if (r.headers.get("cf-mitigated") === "challenge" || s === 401 || s === 403 || s === 429 || s === 503)
    return {
      error: `${host} turned the page reader away (it answered ${s}${r.headers.get("cf-mitigated") ? " with a \"checking your browser\" page" : ""}). Some sites only let a person's browser in.`,
      blocked: true,
    };
  if (s === 410) return { error: `${host} says the page is gone (410).` };
  return { error: `${host} answered ${s}${s >= 500 ? ", a problem on its side; try again later" : ""}.` };
}

export async function handle(request: Request, f: typeof fetch = fetch): Promise<Response> {
  let url = (new URL(request.url).searchParams.get("url") ?? "").trim();
  if (!isPublicUrl(url)) return json(400, { error: "Pass a public web page as ?url=https://..." });

  let r: Response | null = null;
  // Redirects are followed by hand, so each address is checked.
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const host = new URL(url).hostname;
    try {
      r = await f(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "user-agent": "Mozilla/5.0 (compatible; Lightkone; +https://lightkone.lab.kausalflow.com)",
        },
      });
    } catch (e) {
      const slow = (e as Error)?.name === "TimeoutError";
      return json(FAILED, { error: slow ? `${host} took longer than ${TIMEOUT / 1000} s to answer.` : `Couldn't reach ${host}. Check the link.` });
    }
    const next = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!next) break;
    url = new URL(next, url).href;
    if (!isPublicUrl(url)) return json(400, { error: "The page redirects to an address that can't be saved." });
    r = null;
  }
  if (!r) return json(FAILED, { error: "The page redirects too many times." });
  if (!r.ok) return json(r.status === 404 ? 404 : FAILED, r.status === 404 ? { error: "The site has no such page (404)." } : refusal(new URL(url).hostname, r));
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
