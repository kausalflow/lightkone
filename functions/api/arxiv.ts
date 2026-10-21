// Cloudflare Pages Function at /api/arxiv
//
//   ?cats=astro-ph.CO,hep-th   the newest preprints in those categories
//   ?ids=1706.03762,...        the records of these preprints (for their categories)
//
// arXiv's API does not let browsers call it, hence this pass-through. Listings
// are cached for an hour so a busy day asks arXiv once, as its terms ask.
// Answers [{ arxiv, title, abstract, authors, published, categories }].

const ID = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/i;
const CAT = /^[a-z-]+(\.[A-Za-z-]+)?$/;
const MAX_IDS = 200;
const MAX_CATS = 8;
const LISTING = 400;

export interface Preprint {
  arxiv: string;
  title: string;
  abstract: string;
  /** "Last, First" strings, in author order. */
  authors: string[];
  /** First version, ISO. */
  published: string;
  /** Primary category first. */
  categories: string[];
}

const json = (status: number, body: unknown, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*", ...(maxAge ? { "cache-control": `public, max-age=${maxAge}` } : {}) },
  });

const tag = (entry: string, name: string) => entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim();
const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const flat = (s: string | undefined) => unescape(s ?? "").replace(/\s+/g, " ").trim();
const flip = (name: string) => {
  const parts = name.trim().split(" ");
  return parts.length > 1 ? `${parts.pop()}, ${parts.join(" ")}` : name;
};

/** The entries of an arXiv Atom feed. */
export function parseFeed(xml: string): Preprint[] {
  return xml
    .split("<entry>")
    .slice(1)
    .flatMap((entry) => {
      const arxiv = tag(entry, "id")?.match(/abs\/(.+?)(v\d+)?$/)?.[1];
      if (!arxiv) return [];
      const primary = entry.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1];
      const cats = [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]);
      return [{
        arxiv,
        title: flat(tag(entry, "title")),
        abstract: flat(tag(entry, "summary")),
        authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => flip(flat(m[1]))),
        published: tag(entry, "published") ?? "",
        categories: [...new Set([primary, ...cats].filter((c): c is string => Boolean(c)))],
      }];
    });
}

export async function handle(request: Request, f: typeof fetch = fetch): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const list = (name: string) => (q.get(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ids = list("ids").map((s) => s.replace(/v\d+$/, ""));
  const cats = list("cats");
  let url: string;
  if (ids.length) {
    if (ids.length > MAX_IDS || !ids.every((id) => ID.test(id))) return json(400, { error: `Pass up to ${MAX_IDS} arXiv ids as ?ids=1706.03762,...` });
    url = `https://export.arxiv.org/api/query?id_list=${ids.join(",")}&max_results=${ids.length}`;
  } else if (cats.length) {
    if (cats.length > MAX_CATS || !cats.every((c) => CAT.test(c))) return json(400, { error: `Pass up to ${MAX_CATS} arXiv categories as ?cats=hep-th,astro-ph.CO` });
    const query = cats.map((c) => `cat:${c}`).join("+OR+");
    url = `https://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${LISTING}`;
  } else {
    return json(400, { error: "Pass ?cats=hep-th,astro-ph.CO or ?ids=1706.03762" });
  }
  const r = await f(url);
  if (!r.ok) return json(424, { error: `arXiv answered ${r.status}. Try again in a few minutes.` });
  return json(200, parseFeed(await r.text()), cats.length && !ids.length ? 3600 : 86400);
}

export const onRequestGet = async ({ request, waitUntil }: { request: Request; waitUntil(p: Promise<unknown>): void }) => {
  // The edge cache keeps one answer per query, so the hour of caching holds across visitors.
  const cache = (globalThis as any).caches?.default as Cache | undefined;
  const hit = await cache?.match(request);
  if (hit) return hit;
  const res = await handle(request);
  if (cache && res.ok) waitUntil(cache.put(request, res.clone()));
  return res;
};
