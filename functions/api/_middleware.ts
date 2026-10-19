// Runs before every /api/* service. The services exist for this site's own
// app, so this turns away two kinds of misuse that would otherwise run up the
// host's Cloudflare usage:
//
// - other websites calling them from their visitors' browsers (the browser
//   says where a request comes from, in Sec-Fetch-Site and Origin);
// - anyone calling them in a loop: each address gets a number of calls a
//   minute per service, then 429 with Retry-After.
//
// The counts are kept in memory, so they are per Cloudflare server rather than
// global; that is enough against one script hammering the site. For a hard
// global limit, add a rate limiting rule on /api/ in the Cloudflare dashboard
// (docs/HOSTING.md).

/** Calls a minute, per address, for each service. Generous for one person's use. */
export const LIMITS: Record<string, number> = { pdf: 30, published: 30, arxiv: 60, tex: 120, "mcp-link": 10 };
const DEFAULT_LIMIT = 60;
const WINDOW = 60_000;

const recent = new Map<string, number[]>();

/** Records a call; the seconds to wait when over the limit, else 0. */
export function wait(key: string, limit: number, now = Date.now(), calls = recent): number {
  const kept = (calls.get(key) ?? []).filter((t) => t > now - WINDOW);
  if (kept.length >= limit) {
    calls.set(key, kept);
    return Math.max(1, Math.ceil((kept[0] + WINDOW - now) / 1000));
  }
  kept.push(now);
  calls.set(key, kept);
  // Forget quiet addresses now and then, so the map stays small.
  if (calls.size > 5000) for (const [k, ts] of calls) if (!ts.some((t) => t > now - WINDOW)) calls.delete(k);
  return 0;
}

/** True when a browser says the request comes from another website. */
export function fromAnotherSite(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    return new URL(origin).host !== new URL(request.url).host;
  } catch {
    return true;
  }
}

const refuse = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

export async function guard(request: Request, next: () => Promise<Response>, calls = recent): Promise<Response> {
  if (fromAnotherSite(request)) return refuse(403, "These services are for this site's own app.");
  const service = new URL(request.url).pathname.replace(/^\/api\//, "").split("/")[0];
  const who = request.headers.get("cf-connecting-ip") ?? "unknown";
  const seconds = wait(`${service} ${who}`, LIMITS[service] ?? DEFAULT_LIMIT, Date.now(), calls);
  if (seconds) return refuse(429, `Too many requests; try again in ${seconds} s.`, { "retry-after": String(seconds) });
  return next();
}

export const onRequest = ({ request, next }: { request: Request; next: () => Promise<Response> }) => guard(request, next);
