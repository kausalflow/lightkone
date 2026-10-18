import type { BibTarget, Paper, StorageAdapter } from "./types";
import { paperToBibtex } from "./bibtex";
import { citeKeysIn, papersForKeys } from "./writing";

// Watch a manuscript: read the .tex files of a paper in a GitHub repository
// (where Overleaf syncs it) and keep its .bib exactly in step with what it
// cites. Entries the old .bib had for keys the library doesn't know are kept
// as they were, so nothing written by hand is lost.

export interface ManuscriptReport {
  /** Keys the .tex files cite, in order of first use. */
  keys: string[];
  /** How many of them the .bib now holds. */
  inBib: number;
  /** Cited keys found nowhere, each with papers that may be meant. */
  missing: { key: string; maybe: Paper[] }[];
  /** Cited keys kept from the old .bib because the library has no such paper. */
  kept: string[];
  texFiles: string[];
}

const fold = (s: string) => s.toLowerCase();

/** The .tex files in a folder of the repository, subfolders included. */
export async function texFilesIn(repo: StorageAdapter, dir: string): Promise<string[]> {
  const prefix = dir.replace(/^\/+|\/+$/g, "");
  const all = repo.listAll ? await repo.listAll(prefix ? `${prefix}/` : "") : await repo.list(prefix ? `${prefix}/` : "");
  return all.filter((p) => /\.tex$/i.test(p)).sort();
}

/** The entries of a .bib file by key, each as written. */
export function rawEntries(bib: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  for (let m = re.exec(bib); m; m = re.exec(bib)) {
    if (/^(comment|string|preamble)$/i.test(m[1])) continue;
    let depth = 0;
    let end = m.index;
    for (let i = bib.indexOf("{", m.index); i < bib.length; i++) {
      if (bib[i] === "{") depth++;
      else if (bib[i] === "}" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end > m.index) out.set(m[2], bib.slice(m.index, end));
    re.lastIndex = Math.max(re.lastIndex, end);
  }
  return out;
}

/** Papers a key may mean, from the surname and year in it, like riess1998 or Riess:1998ab. */
export function guesses(papers: Paper[], key: string, max = 3): Paper[] {
  const m = key.match(/^([A-Za-z]+)[^0-9]*((?:19|20)\d\d)/);
  if (!m) return [];
  const [, name, year] = m;
  return papers
    .filter((p) => !p.trashed && String(p.year) === year && fold((p.authors[0] ?? "").split(",")[0]).replace(/[^a-z]/g, "") === fold(name))
    .slice(0, max);
}

/** The .bib a manuscript needs, and what was found. `current` is the .bib as it is now. */
export function manuscriptBib(papers: Paper[], tex: string[], target: BibTarget, current: string | null): { text: string; report: Omit<ManuscriptReport, "texFiles"> } {
  const keys = [...new Set(tex.flatMap(citeKeysIn))];
  const byId = new Map(papers.filter((p) => !p.trashed).map((p) => [p.id, p]));
  const { found, missing } = papersForKeys(papers, keys);
  const entries = new Map<string, string>();
  for (const p of found) {
    // Cited by another case of the key: written under the key as cited, so BibTeX finds it.
    const cited = keys.find((k) => fold(k) === fold(p.key)) ?? p.key;
    entries.set(cited, paperToBibtex({ ...p, key: cited }));
  }
  const old = current ? rawEntries(current) : new Map<string, string>();
  const kept: string[] = [];
  const stillMissing: ManuscriptReport["missing"] = [];
  for (const k of missing) {
    const alias = target.aliases?.[k] && byId.get(target.aliases[k]);
    if (alias) entries.set(k, paperToBibtex({ ...alias, key: k }));
    else if (old.has(k)) {
      entries.set(k, old.get(k)!);
      kept.push(k);
    } else stillMissing.push({ key: k, maybe: guesses(papers, k) });
  }
  const list = [...entries].sort((a, b) => a[0].localeCompare(b[0]));
  const where = target.tex ? `${target.repo}/${target.tex}` : target.repo;
  const header = `% The ${list.length} works cited in ${where}, kept in step by Lightkone. Entries for keys not in the library are kept as written; the rest is rewritten.\n\n`;
  return { text: header + list.map(([, e]) => e.trim()).join("\n\n") + "\n", report: { keys, inBib: list.length, missing: stillMissing, kept } };
}

// The .tex files last read for each manuscript, by the version of its folder, so
// a check after a library change reads only the .bib unless the paper changed.
const lastRead = new Map<string, { stamp: string; texFiles: string[]; tex: string[] }>();

/** Read the manuscript, and write its .bib if it changed. Returns what it found and whether it wrote. */
export async function syncManuscript(target: BibTarget, papers: Paper[], repo: StorageAdapter): Promise<{ report: ManuscriptReport; written: boolean }> {
  const decoder = new TextDecoder();
  const id = `${target.repo}/${target.branch ?? ""}/${target.tex ?? ""}`;
  const stamp = (await repo.stamp?.(target.tex ?? "").catch(() => null)) ?? null;
  const last = lastRead.get(id);
  let texFiles: string[];
  let tex: string[];
  if (stamp && last?.stamp === stamp) {
    ({ texFiles, tex } = last);
  } else {
    texFiles = await texFilesIn(repo, target.tex ?? "");
    tex = [];
    for (const f of texFiles) {
      const bytes = await repo.read(f);
      if (bytes) tex.push(decoder.decode(bytes));
    }
    if (stamp) lastRead.set(id, { stamp, texFiles, tex });
  }
  const raw = await repo.read(target.path);
  const current = raw ? decoder.decode(raw) : null;
  const { text, report } = manuscriptBib(papers, tex, target, current);
  // Nothing cited yet, or no .tex found: leave the file alone rather than empty it.
  if (!report.keys.length || text === current) return { report: { ...report, texFiles }, written: false };
  await repo.write(target.path, text, "application/x-bibtex");
  return { report: { ...report, texFiles }, written: true };
}
