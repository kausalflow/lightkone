// Cloudflare Pages Function at /api/file?url=<link to a file>
//
// Adding a PDF (or a supplement, a dataset, slides) from a link: browsers don't
// let one site download another's files, so this fetches the file and hands
// its bytes back to the app, which stores them in the library's own storage.
//
// Like /api/page it only fetches public http(s) addresses on the usual ports,
// checks every redirect, and is limited by /api/_middleware.ts. What it hands
// back is always application/octet-stream sent as an attachment, so nothing
// fetched can run as part of this site; the file's own type, name and final
// address travel in x-file-* headers.

import { isPublicUrl } from "./page";

export const MAX_BYTES = 80 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT = 30_000;
const FAILED = 424;

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" },
  });

/** The file's name: from Content-Disposition when the site gives one, else the last part of its address. */
export function fileName(url: string, disposition: string | null): string {
  const star = disposition && /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)?.[1];
  const plain = disposition && /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)?.[1];
  let name = "";
  try {
    name = star ? decodeURIComponent(star) : plain ?? decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    name = plain ?? "";
  }
  name = name.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return name || new URL(url).hostname;
}

export async function handle(request: Request, f: typeof fetch = fetch): Promise<Response> {
  let url = (new URL(request.url).searchParams.get("url") ?? "").trim();
  if (!isPublicUrl(url)) return json(400, "Pass a public link as ?url=https://...");

  let r: Response | null = null;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const host = new URL(url).hostname;
    try {
      r = await f(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          accept: "application/pdf,*/*;q=0.8",
          "user-agent": "Mozilla/5.0 (compatible; Lightkone; +https://lightkone.lab.kausalflow.com)",
        },
      });
    } catch (e) {
      const slow = (e as Error)?.name === "TimeoutError";
      return json(FAILED, slow ? `${host} took longer than ${TIMEOUT / 1000} s to answer.` : `Couldn't reach ${host}. Check the link.`);
    }
    const next = r.status >= 300 && r.status < 400 ? r.headers.get("location") : null;
    if (!next) break;
    url = new URL(next, url).href;
    if (!isPublicUrl(url)) return json(400, "The link redirects to an address that can't be fetched.");
    r = null;
  }
  if (!r) return json(FAILED, "The link redirects too many times.");
  const host = new URL(url).hostname;
  if (!r.ok) {
    if (r.status === 404) return json(404, `${host} has no such file (404).`);
    if (r.status === 401 || r.status === 403) return json(FAILED, `${host} wouldn't hand the file over (${r.status}). It may need you to be signed in: download it in your browser and add it with Add files.`);
    return json(FAILED, `${host} answered ${r.status}.`);
  }
  if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) return json(413, `The file is bigger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json(413, `The file is bigger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const type = (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  return new Response(bytes, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": "attachment",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      "x-file-type": type,
      "x-file-name": encodeURIComponent(fileName(url, r.headers.get("content-disposition"))),
      "x-file-url": url,
    },
  });
}

export const onRequestGet = ({ request }: { request: Request }) => handle(request);
