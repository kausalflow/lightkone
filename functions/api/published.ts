// Cloudflare Pages Function at /api/published?arxiv=<id>,<id>,...
//
// For arXiv preprints, says which have been published and where: the DOI and
// journal reference authors gave arXiv, then Semantic Scholar for the rest.
// Neither API lets browsers call it directly, hence this small pass-through.
// Answers [{ arxiv, doi?, venue? }] in the order asked.

const ID = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/i;
const MAX = 200;

interface Env {
  S2_API_KEY?: string;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });

const tag = (entry: string, name: string) => entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim();

export async function handle(request: Request, f: typeof fetch = fetch, env: Env = {}): Promise<Response> {
  const ids = (new URL(request.url).searchParams.get("arxiv") ?? "").split(",").map((s) => s.trim().replace(/v\d+$/, "")).filter(Boolean);
  if (!ids.length || ids.length > MAX || !ids.every((id) => ID.test(id))) return json(400, { error: `Pass up to ${MAX} arXiv ids as ?arxiv=1706.03762,...` });
  const out = new Map<string, { arxiv: string; doi?: string; venue?: string }>(ids.map((id) => [id, { arxiv: id }]));

  // arXiv's own record: the DOI and journal reference the authors added.
  const r = await f(`https://export.arxiv.org/api/query?id_list=${ids.join(",")}&max_results=${ids.length}`);
  if (r.ok) {
    for (const entry of (await r.text()).split("<entry>").slice(1)) {
      const id = tag(entry, "id")?.match(/abs\/(.+?)(v\d+)?$/)?.[1];
      const row = id && out.get(id);
      if (!row) continue;
      row.doi = tag(entry, "arxiv:doi")?.split(/\s+/)[0];
      row.venue = tag(entry, "arxiv:journal_ref")?.replace(/\s+/g, " ");
    }
  }

  // Semantic Scholar knows more conference and journal versions; it is rate limited without a key.
  const missing = ids.filter((id) => !out.get(id)!.doi);
  if (missing.length) {
    try {
      const s2 = await f("https://api.semanticscholar.org/graph/v1/paper/batch?fields=externalIds,venue,journal", {
        method: "POST",
        headers: { "content-type": "application/json", ...(env.S2_API_KEY ? { "x-api-key": env.S2_API_KEY } : {}) },
        body: JSON.stringify({ ids: missing.map((id) => `arXiv:${id}`) }),
      });
      if (s2.ok) {
        const rows = (await s2.json()) as ({ externalIds?: { DOI?: string }; venue?: string; journal?: { name?: string } } | null)[];
        rows.forEach((x, i) => {
          const doi = x?.externalIds?.DOI;
          if (!doi || /^10\.48550\//i.test(doi)) return;
          const row = out.get(missing[i])!;
          row.doi = doi;
          row.venue ??= x?.journal?.name || x?.venue || undefined;
        });
      }
    } catch {
      // arXiv's answer alone is still useful
    }
  }
  return json(200, [...out.values()]);
}

export const onRequestGet = ({ request, env }: { request: Request; env: Env }) => handle(request, fetch, env);
