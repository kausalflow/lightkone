import type { LightkonePlugin, PaperDraft } from "../core/types";
import { invertedToText } from "./lookup";

// "What should I read next?" from Semantic Scholar's recommendations, which
// need no key, with OpenAlex as a fallback. Works for any paper with an arXiv id or a DOI.

const flip = (name: string) => {
  const parts = String(name).split(" ");
  return parts.length > 1 ? `${parts.pop()}, ${parts.join(" ")}` : name;
};

async function fromSemanticScholar(id: string, limit: number): Promise<PaperDraft[]> {
  const r = await fetch(
    `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/${encodeURIComponent(id)}?limit=${limit}&fields=title,authors,year,abstract,venue,externalIds`,
  );
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`Semantic Scholar answered ${r.status}. Try again in a minute.`);
  const data = await r.json();
  return (data.recommendedPapers ?? []).map((p: any) => ({
    type: "article",
    title: p.title,
    authors: (p.authors ?? []).map((a: any) => flip(a.name)),
    year: p.year ?? undefined,
    venue: p.venue || undefined,
    abstract: p.abstract ?? undefined,
    arxiv: p.externalIds?.ArXiv,
    doi: p.externalIds?.DOI && !/^10\.48550/i.test(p.externalIds.DOI) ? p.externalIds.DOI : undefined,
    url: p.externalIds?.ArXiv ? `https://arxiv.org/abs/${p.externalIds.ArXiv}` : undefined,
    fields: {},
  }));
}

/** OpenAlex's related works, for when Semantic Scholar is busy or has nothing. */
async function fromOpenAlex(doi: string, limit: number): Promise<PaperDraft[]> {
  const api = "https://api.openalex.org/works";
  const r = await fetch(`${api}/doi:${encodeURIComponent(doi)}?select=related_works`);
  if (!r.ok) return [];
  const ids: string[] = ((await r.json()).related_works ?? []).slice(0, limit).map((u: string) => u.split("/").pop());
  if (!ids.length) return [];
  const select = "title,authorships,publication_year,primary_location,ids,doi,abstract_inverted_index";
  const w = await fetch(`${api}?filter=openalex:${ids.join("|")}&per-page=${limit}&select=${select}`);
  if (!w.ok) return [];
  return ((await w.json()).results ?? [])
    .filter((x: any) => x.title)
    .map((x: any) => {
      const doiOut = x.doi?.replace(/^https:\/\/doi\.org\//, "");
      const arxiv = doiOut?.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
      return {
        type: "article",
        title: x.title,
        authors: (x.authorships ?? []).map((a: any) => flip(a.author?.display_name ?? "")).filter(Boolean),
        year: x.publication_year ?? undefined,
        venue: x.primary_location?.source?.display_name ?? undefined,
        abstract: invertedToText(x.abstract_inverted_index),
        arxiv,
        doi: arxiv ? undefined : doiOut,
        fields: {},
      } satisfies PaperDraft;
    });
}

export async function related(p: { arxiv?: string; doi?: string }, limit = 12): Promise<PaperDraft[]> {
  const id = p.arxiv ? `arXiv:${p.arxiv}` : `DOI:${p.doi}`;
  try {
    const found = await fromSemanticScholar(id, limit);
    if (found.length) return found;
  } catch {
    // busy or blocked: fall through to OpenAlex
  }
  return fromOpenAlex(p.arxiv ? `10.48550/arXiv.${p.arxiv}` : p.doi!, limit);
}

const plugin: LightkonePlugin = {
  id: "related",
  name: "Related papers",
  description: "Finds papers related to one in your library, through Semantic Scholar.",
  settings: [
    {
      name: "openalexKey",
      label: "OpenAlex API key (optional)",
      type: "password",
      help: "Free from openalex.org. Without one, the citation map shares OpenAlex's daily budget with everyone on your network.",
    },
  ],
  actions: [
    {
      id: "related",
      label: "Find related",
      available: (p) => Boolean(p.arxiv || p.doi),
      async run(p) {
        const papers = await related(p);
        return { kind: "papers", title: `Related to ${p.title}`, papers };
      },
    },
  ],
};
export default plugin;
