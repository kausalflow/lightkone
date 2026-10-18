import type { BibTarget, Paper, StorageAdapter } from "./types";
import { libraryToBibtex } from "./bibtex";

// Keeps .bib files in GitHub repositories up to date: one folder's papers (or
// the whole library) per file. Point Overleaf, or a paper's own repository, at
// it and \bibliography{} stays current. Citation keys never change once given,
// so existing \cite{} commands keep working.

const fold = (s: string) => s.toLowerCase();

/** Papers in a folder or any folder inside it; "" is the whole library. Never the trash. */
export function papersInFolder(papers: Paper[], folder: string): Paper[] {
  const f = fold(folder);
  return papers.filter(
    (p) => !p.trashed && (!f || (p.folders ?? []).some((pf) => fold(pf) === f || fold(pf).startsWith(`${f}/`))),
  );
}

export const defaultBibPath = (folder: string) =>
  `${folder ? folder.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() : "library"}.bib`;

export function bibFor(papers: Paper[], folder: string): string {
  const list = papersInFolder(papers, folder).sort((a, b) => a.key.localeCompare(b.key));
  const header = `% ${folder || "Whole library"}: ${list.length} paper${list.length === 1 ? "" : "s"}, kept up to date by Lightkone. Edits here are overwritten.\n\n`;
  return header + libraryToBibtex(list);
}

export interface SyncResult {
  written: string[];
  unchanged: number;
  errors: string[];
}

/** Write each target whose content changed. `open` makes storage for a repository. */
export async function runBibSync(targets: BibTarget[], papers: Paper[], open: (t: BibTarget) => StorageAdapter): Promise<SyncResult> {
  const result: SyncResult = { written: [], unchanged: 0, errors: [] };
  const decoder = new TextDecoder();
  for (const t of targets) {
    const where = `${t.repo}/${t.path}`;
    try {
      const repo = open(t);
      const text = bibFor(papers, t.folder);
      const current = await repo.read(t.path);
      if (current && decoder.decode(current) === text) {
        result.unchanged++;
        continue;
      }
      await repo.write(t.path, text, "application/x-bibtex");
      result.written.push(where);
    } catch (e) {
      result.errors.push(`${where}: ${(e as Error).message}`);
    }
  }
  return result;
}
