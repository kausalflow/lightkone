// Cloudflare Pages Function at /api/pdf?doi=<doi>&email=<contact email>
//
// Publishers do not let browsers download their PDFs from another site, so
// this asks Unpaywall (https://unpaywall.org) for a legal open-access copy of
// the DOI and passes the PDF through. It only ever fetches URLs Unpaywall
// returns for that DOI, so it cannot be used as a general proxy.

const MAX_BYTES = 80 * 1024 * 1024;
const DOI = /^10\.\d{4,9}\/\S+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

interface UnpaywallLocation {
  url_for_pdf?: string | null;
}
interface UnpaywallWork {
  best_oa_location?: UnpaywallLocation | null;
  oa_locations?: UnpaywallLocation[];
}

export async function handle(request: Request, f: typeof fetch = fetch): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const doi = (q.get("doi") ?? "").trim();
  const email = (q.get("email") ?? "").trim();
  if (!DOI.test(doi)) return json(400, "Pass a DOI as ?doi=10.xxxx/...");
  if (!EMAIL.test(email)) return json(400, "Unpaywall needs a contact email: pass ?email=you@example.org");

  const meta = await f(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`);
  if (!meta.ok) return json(meta.status === 404 ? 404 : 502, `Unpaywall answered ${meta.status}`);
  const work = (await meta.json()) as UnpaywallWork;
  const urls = [work.best_oa_location, ...(work.oa_locations ?? [])]
    .map((l) => l?.url_for_pdf)
    .filter((u, i, all): u is string => Boolean(u && /^https?:\/\//.test(u) && all.indexOf(u) === i));

  for (const url of urls) {
    try {
      const r = await f(url, { headers: { accept: "application/pdf", "user-agent": "Lightkone (+https://github.com/kausalflow/lightkone)" } });
      if (!r.ok || !r.body) continue;
      if (Number(r.headers.get("content-length") ?? 0) > MAX_BYTES) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > MAX_BYTES || String.fromCharCode(...bytes.subarray(0, 4)) !== "%PDF") continue;
      return new Response(bytes, {
        headers: {
          "content-type": "application/pdf",
          "access-control-allow-origin": "*",
          "cache-control": "public, max-age=604800",
        },
      });
    } catch {
      // try the next copy
    }
  }
  return json(404, "No open-access PDF found for this DOI");
}

export const onRequestGet = ({ request }: { request: Request }) => handle(request);
