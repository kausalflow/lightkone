import type { Paper, PaperDraft } from "./types";
import { normArxiv, normDoi } from "./library";
import { site } from "./site";

// Tidying a library: finding the same paper entered twice, and preprints that
// have since been published.

const normTitle = (t: string) => t.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const firstAuthor = (p: Paper) => ((p.authors ?? [])[0] ?? "").split(",")[0].normalize("NFKD").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Groups of papers that are probably the same: same DOI, same arXiv id, or the
 * same title (short titles also need the same first author). Trash is ignored.
 */
export function findDuplicates(papers: Paper[]): Paper[][] {
  const live = papers.filter((p) => !p.trashed);
  const parent = new Map<string, string>(live.map((p) => [p.id, p.id]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  const join = (a: string, b: string) => parent.set(root(a), root(b));
  const seen = new Map<string, string>();
  for (const p of live) {
    const t = normTitle(p.title);
    // A DOI or arXiv id that is only spaces (or only the doi.org prefix) says nothing.
    const doi = normDoi(p.doi);
    const arxiv = normArxiv(p.arxiv);
    const keys = [
      doi && `doi:${doi}`,
      arxiv && `arxiv:${arxiv}`,
      t.length > 20 ? `title:${t}` : t.length > 3 && `title:${t}:${firstAuthor(p)}`,
    ].filter(Boolean) as string[];
    for (const k of keys) {
      const other = seen.get(k);
      if (other) join(p.id, other);
      else seen.set(k, p.id);
    }
  }
  const groups = new Map<string, Paper[]>();
  for (const p of live) {
    const r = root(p.id);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** Which one to keep: the one with a PDF, then with notes, then the oldest. */
export function pickKeeper(group: Paper[]): Paper {
  return [...group].sort((a, b) => Number(!!b.pdf) - Number(!!a.pdf) || Number(!!b.notes) - Number(!!a.notes) || a.added.localeCompare(b.added))[0];
}

/** The keeper with everything the others add: tags, folders, notes, star, missing fields and PDF. */
export function mergeInto(keep: Paper, others: Paper[]): Partial<Paper> {
  const all = [keep, ...others];
  const patch: Partial<Paper> = {
    tags: [...new Set(all.flatMap((p) => p.tags ?? []))],
    folders: [...new Set(all.flatMap((p) => p.folders ?? []))],
    notes: [...new Set(all.map((p) => p.notes?.trim()).filter(Boolean))].join("\n\n") || undefined,
    starred: all.some((p) => p.starred) || undefined,
    fields: Object.assign({}, ...[...others].reverse().map((p) => p.fields), keep.fields),
    added: all.map((p) => p.added).sort()[0],
  };
  for (const k of ["abstract", "doi", "arxiv", "url", "venue", "year", "pdf", "file", "opened"] as const) {
    if (!keep[k]) {
      const v = others.find((p) => p[k])?.[k];
      if (v) (patch as Record<string, unknown>)[k] = v;
    }
  }
  return patch;
}

export interface Published {
  paper: Paper;
  /** What changes: the published DOI, venue, year and details. */
  patch: Partial<Paper>;
}

type GetJson = (url: string) => Promise<any>;

const defaultGet: GetJson = async (url) => {
  const r = await fetch(url);
  if (r.status === 404) throw new Error("The published-version service is not available on this site (it runs as a Cloudflare Pages Function).");
  if (!r.ok) throw new Error(`Looking up published versions failed (${r.status}).`);
  return r.json();
};

/**
 * arXiv preprints without a journal DOI that have since appeared in a journal
 * or proceedings: the site's /api/published service says which (from arXiv and
 * Semantic Scholar), and Crossref gives the published record.
 */
export async function findPublished(
  papers: Paper[],
  crossref: (doi: string) => Promise<PaperDraft | null>,
  onProgress: (done: number, total: number) => void = () => {},
  get: GetJson = defaultGet,
  service = "api/published",
): Promise<Published[]> {
  const preprints = papers.filter((p) => !p.trashed && p.arxiv && (!p.doi || /^10\.48550\//i.test(p.doi)));
  const found: Published[] = [];
  for (let i = 0; i < preprints.length; i += 100) {
    const chunk = preprints.slice(i, i + 100);
    const rows: { arxiv: string; doi?: string; venue?: string }[] = await get(site(`${service}?arxiv=${chunk.map((p) => normArxiv(p.arxiv)).join(",")}`));
    for (const [j, p] of chunk.entries()) {
      onProgress(i + j + 1, preprints.length);
      const row = rows.find((r) => r.arxiv.toLowerCase() === normArxiv(p.arxiv));
      if (!row?.doi || /^10\.48550\//i.test(row.doi)) continue;
      const record = await crossref(row.doi).catch(() => null);
      const patch: Partial<Paper> = { doi: record?.doi ?? row.doi };
      const venue = record?.venue ?? row.venue;
      if (venue && !/^arxiv/i.test(venue)) patch.venue = venue;
      if (record?.type) patch.type = record.type;
      if (record?.year) patch.year = record.year;
      if (record?.fields && Object.keys(record.fields).length) patch.fields = { ...p.fields, ...record.fields };
      found.push({ paper: p, patch });
    }
  }
  return found;
}
