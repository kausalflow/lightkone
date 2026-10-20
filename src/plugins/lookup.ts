import type { LightkonePlugin, Lookup, PaperDraft } from "../core/types";
import { parseBibtexToDrafts } from "../core/bibtex";
import { fetchPage, isWebLink, pageDraft, paperIdentifier, rememberPage } from "../core/webpage";

// Adding a paper by what people actually have at hand: a DOI, an arXiv id or
// link, a publisher link with a DOI in it, or pasted BibTeX. All sources are
// free, open APIs that allow browser requests. Any other web page is saved as
// a page: its own title, authors and date, with a copy of its text.

const ARXIV_NEW = /(?:arxiv\.org\/(?:abs|pdf|html)\/|arxiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?/i;
const ARXIV_OLD = /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/i;
const DOI = /(10\.\d{4,9}\/[^\s"<>]+)/;

export function arxivId(input: string): string | null {
  const s = input.trim();
  return s.match(ARXIV_NEW)?.[1] ?? s.match(ARXIV_OLD)?.[1] ?? null;
}

/** New-style arXiv ids start with YYMM. */
export function yearOfArxivId(id: string): number | undefined {
  const m = id.match(/^(\d{2})(\d{2})\./) ?? id.match(/\/(\d{2})(\d{2})\d{3}$/);
  if (!m) return undefined;
  const yy = Number(m[1]);
  return yy >= 91 ? 1900 + yy : 2000 + yy;
}

export function doiOf(input: string): string | null {
  const m = decodeURIComponent(input.trim()).match(DOI)?.[1];
  if (!m) return null;
  const doi = m.replace(/[.,;)\]]+$/, "").replace(/\/(full|abstract|pdf|epdf)$/i, "");
  return /^10\.48550\/arxiv\./i.test(doi) ? null : doi;
}

const stripTags = (s?: string) => s?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || undefined;

async function getJson(url: string): Promise<any | null> {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

/** OpenAlex stores abstracts as an inverted index; rebuild the text. */
export function invertedToText(index?: Record<string, number[]>): string | undefined {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [w, positions] of Object.entries(index)) for (const p of positions) words[p] = w;
  return words.join(" ").trim() || undefined;
}

export async function crossref(doi: string): Promise<PaperDraft | null> {
  const data = await getJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  const w = data?.message;
  if (!w?.title?.[0]) return null;
  const typeMap: Record<string, string> = {
    "journal-article": "article", "proceedings-article": "inproceedings", "book-chapter": "incollection",
    book: "book", monograph: "book", "posted-content": "misc", dissertation: "phdthesis", report: "techreport",
  };
  return {
    type: typeMap[w.type] ?? "misc",
    title: stripTags(w.title[0])!,
    authors: (w.author ?? []).map((a: any) => (a.family ? `${a.family}${a.given ? ", " + a.given : ""}` : a.name)).filter(Boolean),
    year: w.issued?.["date-parts"]?.[0]?.[0] ?? w.published?.["date-parts"]?.[0]?.[0],
    venue: w["container-title"]?.[0] ?? w.publisher,
    abstract: stripTags(w.abstract?.replace(/<jats:title>.*?<\/jats:title>/, "")),
    doi: w.DOI,
    url: w.URL,
    fields: {
      ...(w.volume ? { volume: w.volume } : {}),
      ...(w.issue ? { number: w.issue } : {}),
      ...(w.page ? { pages: w.page } : {}),
      ...(w.publisher ? { publisher: w.publisher } : {}),
    },
  };
}

export async function arxiv(id: string): Promise<PaperDraft | null> {
  // Semantic Scholar first (clean authors, venue, published DOI), OpenAlex as fallback.
  try {
    const s2 = await getJson(
      `https://api.semanticscholar.org/graph/v1/paper/arXiv:${id}?fields=title,authors,year,abstract,venue,externalIds,publicationVenue`,
    );
    if (s2?.title) {
      return {
        type: "article",
        title: s2.title,
        authors: (s2.authors ?? []).map((a: any) => {
          const parts = String(a.name).split(" ");
          return parts.length > 1 ? `${parts.pop()}, ${parts.join(" ")}` : a.name;
        }),
        year: s2.year ?? undefined,
        venue: s2.venue || "arXiv",
        abstract: s2.abstract ?? undefined,
        arxiv: id,
        doi: s2.externalIds?.DOI && !/^10\.48550/i.test(s2.externalIds.DOI) ? s2.externalIds.DOI : undefined,
        url: `https://arxiv.org/abs/${id}`,
        fields: {},
      };
    }
  } catch {
    // rate limited or offline: try OpenAlex
  }
  const oa = await getJson(`https://api.openalex.org/works/doi:10.48550/arXiv.${id}`);
  if (!oa?.title) return null;
  return {
    type: "article",
    title: oa.title,
    authors: (oa.authorships ?? []).map((a: any) => {
      const parts = String(a.author?.display_name ?? "").split(" ");
      return parts.length > 1 ? `${parts.pop()}, ${parts.join(" ")}` : parts[0];
    }),
    // OpenAlex dates arXiv records by their latest version; the id itself says when it first appeared.
    year: yearOfArxivId(id) ?? oa.publication_year ?? undefined,
    venue: "arXiv",
    abstract: invertedToText(oa.abstract_inverted_index),
    arxiv: id,
    url: `https://arxiv.org/abs/${id}`,
    fields: {},
  };
}

const lookups: Lookup[] = [
  {
    id: "arxiv",
    label: "arXiv id or link",
    matches: (s) => arxivId(s) !== null,
    resolve: (s) => arxiv(arxivId(s)!),
  },
  {
    id: "doi",
    label: "DOI or a link containing one",
    matches: (s) => doiOf(s) !== null,
    resolve: (s) => crossref(doiOf(s)!),
  },
  {
    id: "webpage",
    label: "Any other web page, saved with a copy of its text",
    matches: (s) => isWebLink(s),
    resolve: webPage,
  },
];

/** A page that turns out to be a paper (its citation tags name a DOI or arXiv id) is added as that paper. */
async function webPage(input: string): Promise<PaperDraft | null> {
  const page = await fetchPage(input.trim());
  const doc = new DOMParser().parseFromString(page.html, "text/html");
  const id = paperIdentifier(doc);
  if (id) {
    const paper = await (arxivId(id) && id.startsWith("arXiv:") ? arxiv(arxivId(id)!) : crossref(doiOf(id)!)).catch(() => null);
    if (paper) return paper;
  }
  const draft = pageDraft(doc, page.url);
  rememberPage(draft.url!, page);
  rememberPage(input.trim(), page);
  return draft;
}

const plugin: LightkonePlugin = {
  id: "lookup",
  name: "DOI, arXiv and BibTeX",
  description: "Adds papers from a DOI, an arXiv id or link, or pasted BibTeX, using Crossref, Semantic Scholar and OpenAlex.",
  lookups,
  importers: [{ id: "bibtex", label: "BibTeX", accepts: ".bib,.bibtex,.txt", parse: parseBibtexToDrafts }],
};
export default plugin;
