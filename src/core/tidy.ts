import type { Attachment, Paper, PaperDraft } from "./types";
import { normArxiv, normDoi } from "./library";
import { site } from "./site";

// Tidying a library: finding the same paper entered twice, and preprints that
// have since been published.

const normTitle = (t: string) => (t ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const firstAuthor = (p: Paper) => ((p.authors ?? [])[0] ?? "").split(",")[0].normalize("NFKD").toLowerCase().replace(/[^a-z]/g, "");

/** Whether the two papers were marked as not the same. */
export const markedDistinct = (a: Paper, b: Paper): boolean => Boolean(a.distinct?.includes(b.id) || b.distinct?.includes(a.id));

/**
 * Groups of papers that are probably the same: same DOI, same arXiv id, or the
 * same title (short titles also need the same first author). Trash is ignored,
 * and so are pairs marked as not the same.
 */
export function findDuplicates(papers: Paper[]): Paper[][] {
  const live = papers.filter((p) => !p.trashed);
  const parent = new Map<string, string>(live.map((p) => [p.id, p.id]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  const join = (a: string, b: string) => parent.set(root(a), root(b));
  const seen = new Map<string, Paper[]>();
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
      const others = seen.get(k) ?? [];
      const match = others.find((o) => !markedDistinct(p, o));
      if (match) join(p.id, match.id);
      seen.set(k, [...others, p]);
    }
  }
  return groupsOf(live, root);
}

function groupsOf(live: Paper[], root: (id: string) => string): Paper[][] {
  const groups = new Map<string, Paper[]>();
  for (const p of live) {
    const r = root(p.id);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

const trigrams = (t: string): Set<string> => {
  const s = ` ${t} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
};
const dice = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size || 1);
};
const words = (t: string) => (t ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
/** Words that tell papers of a series apart: numbers and roman numerals. */
const SERIES = /^(\d+|i{1,3}|iv|v|vi{1,3}|ix|x)$/;

/**
 * Papers that may be the same but share no identifier or exact title: the
 * same first author, years at most one apart, and titles that read almost
 * alike (a typo, a dropped word, "and" for "&"). Parts of a series (I and II,
 * 1 and 2) are not offered. Groups already found by `findDuplicates` are left out.
 */
export function findLikelyDuplicates(papers: Paper[], sure: Paper[][] = findDuplicates(papers), threshold = 0.84): Paper[][] {
  const live = papers.filter((p) => !p.trashed && normTitle(p.title).length > 12);
  const inSure = new Map<string, number>();
  sure.forEach((g, i) => g.forEach((p) => inSure.set(p.id, i)));
  const byAuthor = new Map<string, Paper[]>();
  for (const p of live) {
    const a = firstAuthor(p);
    if (a) byAuthor.set(a, [...(byAuthor.get(a) ?? []), p]);
  }
  const parent = new Map<string, string>(live.map((p) => [p.id, p.id]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  const grams = new Map<string, Set<string>>();
  const gramsOf = (p: Paper) => grams.get(p.id) ?? grams.set(p.id, trigrams(normTitle(p.title))).get(p.id)!;
  for (const list of byAuthor.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (inSure.has(a.id) && inSure.get(a.id) === inSure.get(b.id)) continue;
        if (a.year && b.year && Math.abs(a.year - b.year) > 1) continue;
        if (markedDistinct(a, b)) continue;
        if (dice(gramsOf(a), gramsOf(b)) < threshold) continue;
        const wa = new Set(words(a.title));
        const wb = new Set(words(b.title));
        const differ = [...wa].filter((w) => !wb.has(w)).concat([...wb].filter((w) => !wa.has(w)));
        if (differ.some((w) => SERIES.test(w))) continue;
        parent.set(root(a.id), root(b.id));
      }
    }
  }
  return groupsOf(live, root);
}

/** Which one to keep: the one with a PDF, then with notes, then the oldest. */
export function pickKeeper(group: Paper[]): Paper {
  return [...group].sort((a, b) => Number(!!b.pdf) - Number(!!a.pdf) || Number(!!b.notes) - Number(!!a.notes) || a.added.localeCompare(b.added))[0];
}

/** Details that can differ between copies, where the person may pick which copy's value to keep. */
export const CHOOSABLE = ["title", "authors", "year", "venue", "type", "doi", "arxiv", "url", "abstract", "key"] as const;
export type Choosable = (typeof CHOOSABLE)[number];
/** For each detail, the id of the copy whose value to keep. */
export type Picks = Partial<Record<Choosable, string>>;

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);
const valueKey = (k: Choosable, v: unknown) => {
  if (k === "doi") return normDoi(v as string) ?? "";
  if (k === "arxiv") return normArxiv(v as string) ?? "";
  if (k === "authors") return (v as string[]).join(";").toLowerCase().replace(/\s+/g, "");
  if (k === "title") return normTitle(v as string);
  return String(v).trim();
};

export interface Choice {
  field: Choosable;
  /** The different values, each with the copies that have it, keeper's (or the first) first. */
  options: { value: unknown; from: string[] }[];
}

/** The details that differ between copies, with what each copy says. Details only one copy has are simply kept. */
export function choicesFor(keep: Paper, group: Paper[]): Choice[] {
  const ordered = [keep, ...group.filter((p) => p.id !== keep.id)];
  const out: Choice[] = [];
  for (const field of CHOOSABLE) {
    const options: Choice["options"] = [];
    for (const p of ordered) {
      const v = p[field];
      if (isEmpty(v)) continue;
      const k = valueKey(field, v);
      const had = options.find((o) => valueKey(field, o.value) === k);
      if (had) had.from.push(p.id);
      else options.push({ value: v, from: [p.id] });
    }
    if (options.length > 1) out.push({ field, options });
  }
  return out;
}

const baseName = (path: string) => path.split("/").pop() || path;

/**
 * The keeper with everything the others add: tags, folders, notes, star,
 * missing details, every file (other copies' PDFs become attachments), and
 * their citation keys as aliases (BibLaTeX `ids`), so a manuscript citing an
 * old key still finds the paper. `picks` chooses, per detail, whose value wins.
 */
export function mergeInto(keep: Paper, others: Paper[], picks: Picks = {}): Partial<Paper> {
  const all = [keep, ...others];
  const byId = new Map(all.map((p) => [p.id, p]));
  const patch: Partial<Paper> = {
    tags: [...new Set(all.flatMap((p) => p.tags ?? []))],
    folders: [...new Set(all.flatMap((p) => p.folders ?? []))],
    notes: [...new Set(all.map((p) => p.notes?.trim()).filter(Boolean))].join("\n\n") || undefined,
    starred: all.some((p) => p.starred) || undefined,
    fields: Object.assign({}, ...[...others].reverse().map((p) => p.fields), keep.fields),
    added: all.map((p) => p.added).sort()[0],
  };
  for (const k of ["abstract", "doi", "arxiv", "url", "venue", "year", "pdf", "file", "opened", "html", "markdown", "health"] as const) {
    if (isEmpty(keep[k])) {
      const v = others.find((p) => !isEmpty(p[k]))?.[k];
      if (!isEmpty(v)) (patch as Record<string, unknown>)[k] = v;
    }
  }
  for (const [field, id] of Object.entries(picks) as [Choosable, string][]) {
    const from = byId.get(id);
    if (!from || isEmpty(from[field])) continue;
    if (from === keep) delete (patch as Record<string, unknown>)[field];
    else (patch as Record<string, unknown>)[field] = from[field];
  }
  if (patch.year !== undefined && typeof patch.year !== "number") patch.year = Number(patch.year) || undefined;

  // Every file stays with the paper: the main PDF, and the rest as attachments.
  const main = patch.pdf ?? keep.pdf;
  const files = new Map<string, Attachment>();
  for (const p of all) {
    for (const a of p.attachments ?? []) if (a.path !== main && !files.has(a.path)) files.set(a.path, a);
    if (p.pdf && p.pdf !== main && !files.has(p.pdf)) files.set(p.pdf, { path: p.pdf, name: baseName(p.pdf), type: "application/pdf", added: p.added });
  }
  if (files.size) patch.attachments = [...files.values()];

  // Old citation keys live on as aliases.
  const key = patch.key ?? keep.key;
  const fields = patch.fields!;
  const aliases = [...new Set([...(fields.ids ?? "").split(",").map((x) => x.trim()), ...all.map((p) => p.key)])].filter((k) => k && k !== key);
  if (aliases.length) fields.ids = aliases.join(",");
  else delete fields.ids;

  const ids = new Set(all.map((p) => p.id));
  const distinct = [...new Set(all.flatMap((p) => p.distinct ?? []))].filter((id) => !ids.has(id));
  patch.distinct = distinct.length ? distinct : undefined;
  return patch;
}

/** What marks a merged copy: in the trash, pointing at the paper it went into. */
export const mergedMark = (keepId: string, now = new Date().toISOString()): Partial<Paper> => ({ trashed: now, mergedInto: keepId });

/** A paper's id and the ids of the copies merged into it, for finding chats and highlights made on any of them. */
export function aliasIds(papers: Paper[], id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const p of papers) if (p.mergedInto === out[i] && p.trashed && !out.includes(p.id)) out.push(p.id);
  return out;
}

// ---- Scanning the library for entries that need a look ----

export type IssueKind = "no-source" | "missing-file" | "no-title" | "no-authors" | "no-year" | "odd-year" | "bad-doi" | "bad-arxiv" | "key-clash";

/** Each kind: its heading, a short form for counts ("3 no year"), and what it means. */
export const ISSUES: Record<IssueKind, { label: string; short: string; help: string }> = {
  "missing-file": { short: "missing from storage", label: "File missing from storage", help: "The paper points at a PDF, attachment or saved page that is no longer in the library's storage." },
  "no-source": { short: "no link and no PDF", label: "No link and no PDF", help: "No DOI, arXiv id, web link, PDF, file or saved page: nothing to open." },
  "key-clash": { short: "same citation key", label: "Same citation key", help: "Several papers share a citation key, so LaTeX can only find one of them." },
  "no-title": { short: "no title", label: "No title", help: "The entry has no title, or only a placeholder." },
  "no-authors": { short: "no authors", label: "No authors", help: "The entry lists no authors." },
  "no-year": { short: "no year", label: "No year", help: "The entry has no year." },
  "odd-year": { short: "unlikely year", label: "Unlikely year", help: "The year is before 1600 or in the future." },
  "bad-doi": { short: "odd DOI", label: "DOI looks wrong", help: "A DOI starts with 10. and has a slash, like 10.1103/PhysRev.47.777." },
  "bad-arxiv": { short: "odd arXiv id", label: "arXiv id looks wrong", help: "An arXiv id looks like 2401.01234 or hep-th/9711200." },
};

export interface Issue {
  kind: IssueKind;
  paper: Paper;
  /** What exactly, e.g. the missing file's path or the shared key. */
  detail?: string;
}

export interface Scan {
  /** When the scan ran, ISO. */
  at: string;
  /** Live papers looked at. */
  papers: number;
  duplicates: Paper[][];
  likely: Paper[][];
  issues: Issue[];
  /** Whether files were checked against storage (it may not be listable). */
  filesChecked: boolean;
}

/** Storage keys a paper points at: its PDF, attachments and saved page. */
export const filesOf = (p: Paper): string[] => [p.pdf, ...(p.attachments ?? []).map((a) => a.path), p.html, p.markdown].filter(Boolean) as string[];

const DOI = /^10\.\d{4,9}\/\S+$/;
const ARXIV = /^(\d{4}\.\d{4,5}|[a-z-]+(\.[a-z]{2})?\/\d{7})$/;
const PLACEHOLDER = /^(untitled|no title|title|unknown)$/i;

/**
 * Look over every live paper for what needs a look: duplicates (sure and
 * likely), entries with nothing to open, files gone from storage (when `files`
 * lists what storage holds), missing or odd details, and clashing keys.
 */
export function scanLibrary(papers: Paper[], files: Set<string> | null, now = new Date()): Scan {
  const live = papers.filter((p) => !p.trashed);
  const issues: Issue[] = [];
  const add = (kind: IssueKind, paper: Paper, detail?: string) => issues.push({ kind, paper, detail });
  const keys = new Map<string, Paper[]>();
  for (const p of live) keys.set(p.key, [...(keys.get(p.key) ?? []), p]);
  for (const p of live) {
    if (files) for (const f of filesOf(p)) if (!files.has(f)) add("missing-file", p, f);
    if (!p.doi?.trim() && !p.arxiv?.trim() && !p.url?.trim() && !p.file?.trim() && !filesOf(p).length) add("no-source", p);
    if ((keys.get(p.key)?.length ?? 0) > 1) add("key-clash", p, p.key);
    if (!p.title?.trim() || PLACEHOLDER.test(p.title.trim())) add("no-title", p);
    if (!(p.authors ?? []).some((a) => a?.trim())) add("no-authors", p);
    if (!p.year) add("no-year", p);
    else if (p.year < 1600 || p.year > now.getFullYear() + 1) add("odd-year", p, String(p.year));
    const doi = normDoi(p.doi);
    if (doi && !DOI.test(doi)) add("bad-doi", p, p.doi);
    const arxiv = normArxiv(p.arxiv);
    if (arxiv && !ARXIV.test(arxiv)) add("bad-arxiv", p, p.arxiv);
  }
  const duplicates = findDuplicates(papers);
  return { at: now.toISOString(), papers: live.length, duplicates, likely: findLikelyDuplicates(papers, duplicates), issues, filesChecked: Boolean(files) };
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
