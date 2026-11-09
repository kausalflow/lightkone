import type { Paper } from "./types";
import { normArxiv, normDoi } from "./library";
import { site } from "./site";

const ax = (a?: string) => normArxiv(a) ?? "";

// Paper health: whether a paper has been retracted, corrected, given an
// expression of concern, or withdrawn on arXiv. Crossref carries publishers'
// notices and the Retraction Watch database; arXiv says when a preprint's
// latest version withdraws it. What is found is kept on the paper, so the
// badge shows without asking again, and checked afresh now and then.

export type { Health, HealthKind, Notice } from "./types";
import type { Health, HealthKind, Notice } from "./types";

/** Most serious first. */
export const SEVERITY: HealthKind[] = ["retracted", "withdrawn", "concern", "corrected", "addendum"];

export const HEALTH_LABEL: Record<HealthKind, string> = {
  retracted: "Retracted",
  withdrawn: "Withdrawn",
  concern: "Expression of concern",
  corrected: "Corrected",
  addendum: "Addendum",
};

/** Crossref's update types, as kinds; the rest (new versions, clarifications of metadata) are left out. */
const KINDS: Record<string, HealthKind> = {
  retraction: "retracted",
  withdrawal: "retracted",
  removal: "retracted",
  partial_retraction: "corrected",
  expression_of_concern: "concern",
  correction: "corrected",
  erratum: "corrected",
  corrigendum: "corrected",
  addendum: "addendum",
};

/** The notices in a Crossref work's `updated-by` list, one per notice and kind even when publisher and Retraction Watch both report it. */
export function noticesFrom(updatedBy: any[] | undefined): Notice[] {
  const out = new Map<string, Notice>();
  for (const u of updatedBy ?? []) {
    const kind = KINDS[String(u?.type ?? "").toLowerCase().replace(/[\s-]+/g, "_")];
    if (!kind) continue;
    const doi = typeof u.DOI === "string" ? u.DOI.toLowerCase() : undefined;
    const parts: number[] | undefined = u.updated?.["date-parts"]?.[0];
    const date = parts?.length ? parts.map((n, i) => (i ? String(n).padStart(2, "0") : String(n))).join("-") : undefined;
    const key = `${kind}:${doi ?? date ?? ""}`;
    const had = out.get(key);
    const source = typeof u.source === "string" ? u.source : undefined;
    if (had) {
      if (source && !had.source?.split(", ").includes(source)) had.source = had.source ? `${had.source}, ${source}` : source;
      had.date ??= date;
      continue;
    }
    out.set(key, { kind, label: typeof u.label === "string" && u.label ? u.label : HEALTH_LABEL[kind], doi, date, source });
  }
  return [...out.values()].sort(bySeverity);
}

const bySeverity = (a: Notice, b: Notice) => SEVERITY.indexOf(a.kind) - SEVERITY.indexOf(b.kind) || (b.date ?? "").localeCompare(a.date ?? "");

/** The most serious notice on a paper, if any. */
export function worst(p: Pick<Paper, "health">): Notice | undefined {
  return p.health?.notices.slice().sort(bySeverity)[0];
}

/** Whether a paper has a DOI or arXiv id to check, and is not in the trash. */
export const checkable = (p: Paper): boolean => !p.trashed && Boolean(checkableDoi(p.doi) || ax(p.arxiv));

/** Whether a paper is due a check: never checked, or not for `days`. */
export function due(p: Paper, now = Date.now(), days = 30): boolean {
  if (!checkable(p)) return false;
  return !p.health || now - Date.parse(p.health.checked) > days * 864e5;
}

/** A DOI worth asking Crossref about: arXiv's own DOIs carry no notices. */
const checkableDoi = (doi?: string) => {
  const d = normDoi(doi);
  return d && !/^10\.48550\//.test(d) ? d : "";
};

type Fetch = (url: string) => Promise<Response>;

const CROSSREF = "https://api.crossref.org/works";
/** DOIs asked of Crossref at once; its filter takes many, the URL stays short. */
const BATCH = 40;

/** Crossref's notices for each DOI, by lower-case DOI. DOIs Crossref doesn't know are left out. */
export async function crossrefNotices(dois: string[], f: Fetch = (u) => fetch(u)): Promise<Map<string, Notice[]>> {
  const out = new Map<string, Notice[]>();
  const all = [...new Set(dois.map((d) => d.toLowerCase()))];
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    const filter = chunk.map((d) => `doi:${d}`).join(",");
    const r = await f(`${CROSSREF}?filter=${encodeURIComponent(filter)}&select=DOI,updated-by&rows=${chunk.length}`);
    if (r.status === 429) throw new Error("Crossref is asking Lightkone to slow down. Try again in a few minutes.");
    if (!r.ok) throw new Error(`Crossref answered ${r.status}.`);
    for (const item of (await r.json()).message?.items ?? []) {
      if (typeof item.DOI === "string") out.set(item.DOI.toLowerCase(), noticesFrom(item["updated-by"]));
    }
  }
  return out;
}

export interface ArxivRow {
  arxiv: string;
  doi?: string;
  venue?: string;
  withdrawn?: string;
}

/** arXiv's word on each preprint (published DOI, withdrawal), from the site's /api/published service. */
export async function arxivRows(ids: string[], f: Fetch = (u) => fetch(u), service = "api/published"): Promise<Map<string, ArxivRow>> {
  const out = new Map<string, ArxivRow>();
  const all = [...new Set(ids)];
  for (let i = 0; i < all.length; i += 100) {
    const r = await f(site(`${service}?arxiv=${all.slice(i, i + 100).join(",")}`));
    if (r.status === 404) throw new Error("The arXiv service is not available on this site (it runs as a Cloudflare Pages Function).");
    if (!r.ok) throw new Error(`Looking up arXiv records failed (${r.status}).`);
    for (const row of (await r.json()) as ArxivRow[]) out.set(row.arxiv.toLowerCase(), row);
  }
  return out;
}

/**
 * Check papers: Crossref for each DOI, and for preprints arXiv (withdrawn?)
 * plus Crossref for the published version arXiv knows of. Answers each
 * checked paper's health, by paper id. A service that fails is skipped, so
 * one being down doesn't hide the other's notices; when both fail it throws.
 */
export async function checkHealth(
  papers: Paper[],
  o: { fetch?: Fetch; onProgress?: (done: number, total: number) => void; now?: string; service?: string } = {},
): Promise<Map<string, Health>> {
  const f = o.fetch ?? ((u: string) => fetch(u));
  const now = o.now ?? new Date().toISOString();
  const list = papers.filter(checkable);
  const total = list.length;
  o.onProgress?.(0, total);

  let arxivError: Error | null = null;
  let rows = new Map<string, ArxivRow>();
  const ids = list.map((p) => ax(p.arxiv)).filter(Boolean);
  if (ids.length) {
    try {
      rows = await arxivRows(ids, f, o.service);
    } catch (e) {
      arxivError = e as Error;
    }
  }

  // The DOI each paper is checked under: its own, else the published version arXiv names.
  const doiOf = new Map<string, { doi: string; via?: string }>();
  for (const p of list) {
    const own = checkableDoi(p.doi);
    const row = rows.get(ax(p.arxiv));
    const published = checkableDoi(row?.doi);
    if (own) doiOf.set(p.id, { doi: own });
    else if (published) doiOf.set(p.id, { doi: published, via: published });
  }

  let crossrefError: Error | null = null;
  const notices = new Map<string, Notice[]>();
  const dois = [...new Set([...doiOf.values()].map((d) => d.doi))];
  for (let i = 0; i < dois.length; i += BATCH * 5) {
    try {
      const got = await crossrefNotices(dois.slice(i, i + BATCH * 5), f);
      got.forEach((v, k) => notices.set(k, v));
    } catch (e) {
      crossrefError = e as Error;
      break;
    }
    o.onProgress?.(Math.min(total, Math.round(((i + BATCH * 5) / dois.length) * total)), total);
  }

  const out = new Map<string, Health>();
  for (const p of list) {
    const found: Notice[] = [];
    const row = rows.get(ax(p.arxiv));
    if (row?.withdrawn) found.push({ kind: "withdrawn", label: "Withdrawn on arXiv", source: "arxiv", reason: row.withdrawn });
    const d = doiOf.get(p.id);
    if (d) for (const n of notices.get(d.doi) ?? []) found.push(d.via ? { ...n, of: d.via } : n);
    // A paper only gets a fresh check date when the services it needs answered.
    if (((ax(p.arxiv) && arxivError) || (d && crossrefError)) && !found.length) continue;
    out.set(p.id, { checked: now, notices: found.sort(bySeverity) });
  }
  o.onProgress?.(total, total);
  if ((arxivError || crossrefError) && !out.size && list.length) throw arxivError ?? crossrefError!;
  return out;
}

/** Whether two healths say the same, so an unchanged check need not be saved. */
export function sameNotices(a: Health | undefined, b: Health): boolean {
  const key = (h?: Health) => JSON.stringify((h?.notices ?? []).map((n) => [n.kind, n.doi, n.date, n.reason, n.of]));
  return key(a) === key(b);
}
