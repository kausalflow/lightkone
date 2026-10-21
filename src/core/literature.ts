import type { Paper, PaperDraft } from "./types";
import { invertedToText } from "../plugins/lookup";
import { normArxiv, normDoi } from "./library";
import { terms } from "./ask";

// Questions beyond the library: OpenAlex's search over published work, read
// from titles and abstracts, so Claude can answer with citations and any
// paper it cites can be added in one tap.

const API = "https://api.openalex.org/works";
const SELECT = "id,title,authorships,publication_year,primary_location,doi,abstract_inverted_index,cited_by_count";

const flip = (name: string) => {
  const parts = String(name).split(" ");
  return parts.length > 1 ? `${parts.pop()}, ${parts.join(" ")}` : name;
};

/** An OpenAlex work as a paper draft, with arXiv preprints given their arXiv id. */
export function workToDraft(x: any): PaperDraft {
  const doi = x.doi?.replace(/^https:\/\/doi\.org\//, "");
  const arxiv = doi?.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  return {
    type: "article",
    title: x.title,
    authors: (x.authorships ?? []).map((a: any) => flip(a.author?.display_name ?? "")).filter(Boolean),
    year: x.publication_year ?? undefined,
    venue: x.primary_location?.source?.display_name ?? undefined,
    abstract: invertedToText(x.abstract_inverted_index),
    arxiv,
    doi: arxiv ? undefined : doi,
    url: arxiv ? `https://arxiv.org/abs/${arxiv}` : undefined,
    fields: {},
  };
}

/** A paper found outside the library, shaped like one in it so the Ask panel can cite it. */
export interface Outside extends Paper {
  draft: PaperDraft;
  cited?: number;
}

/** Published papers that match a question, best first, each with an abstract. */
export async function searchLiterature(question: string, o: { key?: string; fetch?: typeof fetch; signal?: AbortSignal; limit?: number } = {}): Promise<Outside[]> {
  const words = terms(question);
  if (!words.length) return [];
  const url = `${API}?search=${encodeURIComponent(words.join(" "))}&filter=has_abstract:true&per-page=${o.limit ?? 20}&select=${SELECT}${o.key ? `&api_key=${encodeURIComponent(o.key)}` : ""}`;
  const r = await (o.fetch ?? fetch)(url, { signal: o.signal });
  if (r.status === 429) throw new Error("OpenAlex's free daily budget for your network is used up. Add a free OpenAlex key under Settings → Related papers, or try again tomorrow.");
  if (!r.ok) throw new Error(`OpenAlex answered ${r.status}. Try again in a minute.`);
  return ((await r.json()).results ?? [])
    .filter((x: any) => x.title && x.abstract_inverted_index)
    .map((x: any) => {
      const draft = workToDraft(x);
      const out: Outside = { ...draft, type: "article", authors: draft.authors ?? [], fields: {}, id: `oa:${String(x.id).split("/").pop()}`, key: "", tags: [], added: "", draft, cited: x.cited_by_count ?? undefined };
      return out;
    });
}

/** The library's copy of a paper found outside it, matched by DOI, arXiv id or title. */
export function inLibrary(d: PaperDraft, papers: Paper[]): Paper | undefined {
  const title = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const doi = normDoi(d.doi);
  const arxiv = normArxiv(d.arxiv);
  const t = title(d.title);
  return papers.find((p) => !p.trashed && ((doi && normDoi(p.doi) === doi) || (arxiv && normArxiv(p.arxiv) === arxiv) || title(p.title) === t));
}
