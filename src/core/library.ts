import type { BibTarget, LibraryFile, Paper, PaperDraft, StorageAdapter } from "./types";
import { libraryToBibtex } from "./bibtex";
import { foldersFromPaperpile } from "./folders";
import { mergeLibraries } from "./merge";

// The library is plain files in whatever storage the user picked:
//   lightkone/library.json  the source of truth
//   lightkone/library.bib   written on every save, ready for LaTeX and Overleaf
//   Paperpile/All Papers/...  PDFs, filed the way Paperpile files them (core/filing.ts)
//   lightkone/annotations/<id>.json  highlights and notes (core/annotations.ts)
export const LIBRARY_PATH = "lightkone/library.json";
export const BIB_PATH = "lightkone/library.bib";

const decoder = new TextDecoder();

export const normDoi = (d?: string) => d?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "") || undefined;
export const normArxiv = (a?: string) => a?.trim().toLowerCase().replace(/^arxiv:/, "").replace(/v\d+$/, "") || undefined;
const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Paperpile-style citation key: Lastname + year + two letters from the title. */
export function makeKey(d: PaperDraft, taken: Set<string>): string {
  const last = (d.authors?.[0] ?? "Anon").split(",")[0].normalize("NFKD").replace(/[^A-Za-z]/g, "") || "Anon";
  const words = d.title.toLowerCase().replace(/[^a-z ]/g, "").split(" ").filter((w) => w.length > 3);
  const base = `${last[0].toUpperCase()}${last.slice(1)}${d.year ?? ""}`;
  let suffix = ((words[0] ?? "xx").slice(0, 1) + (words[1] ?? words[0] ?? "xx").slice(0, 1)).padEnd(2, "x");
  let key = `${base}-${suffix}`;
  for (let i = 2; taken.has(key); i++) key = `${base}-${suffix}${i}`;
  return key;
}

const parseFile = (raw: string): LibraryFile => {
  const file = JSON.parse(raw) as LibraryFile;
  if (file.format !== "lightkone-library") throw new Error("lightkone/library.json is not a Lightkone library.");
  return file;
};

export class Library {
  papers: Paper[] = [];
  bibSync: BibTarget[] = [];
  private listeners = new Set<() => void>();
  /** library.json as this device last read or wrote it: what a merge starts from. */
  private base: string | null = null;
  /** Saves and refreshes run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(public storage: StorageAdapter | null = null) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  async load(): Promise<{ loaded: number; seeded: number; foldered: number }> {
    this.papers = [];
    this.bibSync = [];
    this.base = null;
    if (!this.storage) return { loaded: 0, seeded: 0, foldered: 0 };
    const raw = await this.storage.read(LIBRARY_PATH);
    if (raw) {
      this.base = decoder.decode(raw);
      const file = parseFile(this.base);
      this.papers = file.papers;
      this.bibSync = file.bibSync ?? [];
    }
    const loaded = this.papers.length;
    let seeded = 0;
    if (this.storage.seed) seeded = this.merge(await this.storage.seed()).added.length;
    // Papers from before folders existed take theirs from Paperpile's file paths, once.
    let foldered = 0;
    for (const p of this.papers) {
      if (p.folders) continue;
      p.folders = foldersFromPaperpile(p.file);
      if (p.folders.length) foldered++;
    }
    this.emit();
    return { loaded, seeded, foldered };
  }

  private file(): LibraryFile {
    return { format: "lightkone-library", version: 1, papers: this.papers, ...(this.bibSync.length ? { bibSync: this.bibSync } : {}) };
  }

  /**
   * Take in what was saved elsewhere since this device last read or wrote,
   * keeping this device's own changes. Returns how many papers changed.
   */
  private async catchUp(): Promise<number> {
    const raw = await this.storage!.read(LIBRARY_PATH);
    const now = raw && decoder.decode(raw);
    if (!now || now === this.base) return 0;
    const { file, fromThem } = mergeLibraries(this.base ? parseFile(this.base) : null, this.file(), parseFile(now));
    this.papers = file.papers;
    this.bibSync = file.bibSync ?? [];
    this.base = now;
    if (fromThem) this.emit();
    return fromThem;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  /** Save, first merging in changes saved elsewhere. Returns how many papers took such changes. */
  save(): Promise<number> {
    return this.serial(async () => {
      if (!this.storage) return 0;
      const merged = await this.catchUp();
      const text = JSON.stringify(this.file(), null, 1);
      if (text === this.base) return merged;
      await this.storage.write(LIBRARY_PATH, text, "application/json");
      this.base = text;
      await this.storage.write(BIB_PATH, libraryToBibtex(this.papers), "application/x-bibtex");
      return merged;
    });
  }

  /** Pick up changes saved elsewhere without writing. Returns how many papers changed. */
  refresh(): Promise<number> {
    return this.serial(async () => (this.storage ? this.catchUp() : 0));
  }

  findDuplicate(d: PaperDraft): Paper | undefined {
    const doi = normDoi(d.doi);
    const arxiv = normArxiv(d.arxiv);
    const title = normTitle(d.title);
    return this.papers.find(
      (p) =>
        (doi && normDoi(p.doi) === doi) ||
        (arxiv && normArxiv(p.arxiv) === arxiv) ||
        (d.key && p.key === d.key) ||
        (title.length > 20 && normTitle(p.title) === title),
    );
  }

  /** Adds drafts that are not already in the library. Existing papers gain missing fields and tags. */
  merge(drafts: PaperDraft[]): { added: Paper[]; updated: Paper[] } {
    const added: Paper[] = [];
    const updated: Paper[] = [];
    const keys = new Set(this.papers.map((p) => p.key));
    for (const d of drafts) {
      if (!d.title?.trim()) continue;
      const existing = this.findDuplicate(d);
      if (existing) {
        let changed = false;
        for (const k of ["abstract", "doi", "arxiv", "url", "venue", "year", "file"] as const) {
          if (!existing[k] && d[k]) {
            (existing as unknown as Record<string, unknown>)[k] = d[k];
            changed = true;
          }
        }
        const tags = [...new Set([...existing.tags, ...(d.tags ?? [])])];
        if (tags.length !== existing.tags.length) {
          existing.tags = tags;
          changed = true;
        }
        const folders = [...new Set([...(existing.folders ?? []), ...(d.folders ?? foldersFromPaperpile(d.file))])];
        if (folders.length !== (existing.folders ?? []).length) {
          existing.folders = folders;
          changed = true;
        }
        if (changed) updated.push(existing);
        continue;
      }
      const key = d.key && !keys.has(d.key) ? d.key : makeKey(d, keys);
      keys.add(key);
      const paper: Paper = {
        type: "article",
        authors: [],
        fields: {},
        ...d,
        tags: d.tags ?? [],
        folders: d.folders ?? foldersFromPaperpile(d.file),
        id: newId(),
        key,
        added: d.added ?? new Date().toISOString(),
      };
      this.papers.push(paper);
      added.push(paper);
    }
    if (added.length || updated.length) this.emit();
    return { added, updated };
  }

  update(id: string, patch: Partial<Paper>): void {
    const p = this.papers.find((x) => x.id === id);
    if (!p) return;
    Object.assign(p, patch, { id: p.id });
    this.emit();
  }

  remove(id: string): void {
    this.papers = this.papers.filter((p) => p.id !== id);
    this.emit();
  }

  tagCounts(): [string, number][] {
    const counts = new Map<string, number>();
    for (const p of this.papers) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }));
  }
}
