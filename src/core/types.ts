// The shapes everything else agrees on. Plugins only depend on this file.

/** One paper in the library. Unknown BibTeX fields survive in `fields`. */
export interface Paper {
  id: string;
  /** BibTeX citation key, e.g. "Hinton2012-ab". Unique within a library. */
  key: string;
  /** BibTeX entry type in lower case: article, inproceedings, book, misc ... */
  type: string;
  title: string;
  /** "Last, First" strings, in author order. */
  authors: string[];
  year?: number;
  venue?: string;
  abstract?: string;
  doi?: string;
  arxiv?: string;
  url?: string;
  tags: string[];
  /** A file path from another manager, e.g. Paperpile's "All Papers/..." on Google Drive. */
  file?: string;
  /** Storage key of a PDF kept in this library's own storage. */
  pdf?: string;
  notes?: string;
  /** ISO timestamp. */
  added: string;
  /** Folders the paper is in, as paths like "Physics/QFT". A paper can be in several. */
  folders?: string[];
  starred?: boolean;
  /** When it was moved to the trash (ISO); trashed papers are hidden until restored. */
  trashed?: string;
  /** When it was last opened in the reader (ISO). */
  opened?: string;
  /** Who added it, in a shared library: the name they gave in Settings. */
  by?: string;
  /** Remaining BibTeX fields, lower-cased names, raw values. */
  fields: Record<string, string>;
}

/** What a lookup or importer returns before the library assigns id and key. */
export type PaperDraft = Partial<Paper> & { title: string };

export interface LibraryFile {
  format: "lightkone-library";
  version: 1;
  papers: Paper[];
  /** .bib files kept up to date in GitHub repositories, e.g. for Overleaf. */
  bibSync?: BibTarget[];
}

/** One folder's papers (or the whole library, folder "") written as a .bib file to a GitHub repository. */
export interface BibTarget {
  folder: string;
  repo: string;
  path: string;
  branch?: string;
  /**
   * A manuscript to watch: the folder of the repository holding its .tex files
   * ("" for the top). The .bib then holds exactly the papers they cite, and
   * `folder` is not used.
   */
  tex?: string;
  /** Keys the manuscript cites that are not library keys, matched by hand: cited key to paper id. */
  aliases?: Record<string, string>;
}

/** A place a library lives. Paths are relative to the adapter's root. */
export interface StorageAdapter {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array | string, contentType?: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Whether this device may change what is stored: "read" when the owner gave read access only. */
  access?(): Promise<"read" | "write">;
  /** A version of everything under a folder, which changes whenever anything in it does. */
  stamp?(folder: string): Promise<string | null>;
  /** Every file under a prefix, in subfolders too. */
  listAll?(prefix: string): Promise<string[]>;
  remove?(path: string): Promise<void>;
  /** Extra papers the backend already holds in another format (e.g. Paperpile's .bib sync). */
  seed?(): Promise<PaperDraft[]>;
}

export interface Field {
  name: string;
  label: string;
  /** A checkbox stores "off" when unticked; it is on by default. */
  type?: "text" | "password" | "textarea" | "checkbox";
  placeholder?: string;
  help?: string;
}

export interface StorageProvider {
  id: string;
  label: string;
  description: string;
  fields: Field[];
  create(config: Record<string, string>): StorageAdapter;
}

/** Turns an identifier (DOI, arXiv id, URL ...) into a paper. Returns null when it does not apply. */
export interface Lookup {
  id: string;
  label: string;
  matches(input: string): boolean;
  resolve(input: string): Promise<PaperDraft | null>;
}

/** Turns pasted text or an uploaded file into papers. */
export interface Importer {
  id: string;
  label: string;
  accepts: string;
  parse(text: string): PaperDraft[];
}

export type ActionResult =
  | { kind: "text"; title: string; text: string; /** A button under the text that runs the action again. */ again?: string }
  | { kind: "papers"; title: string; papers: PaperDraft[] }
  | { kind: "none" };

export interface ActionContext {
  settings: Record<string, string>;
  storage: StorageAdapter | null;
  library: Paper[];
  open(url: string): void;
  /** Asks the user for some text in a dialog; null when they cancel. */
  ask(question: string, placeholder?: string): Promise<string | null>;
}

/** A button on a paper. */
export interface PaperAction {
  id: string;
  label: string;
  available?(paper: Paper): boolean;
  run(paper: Paper, ctx: ActionContext): Promise<ActionResult>;
}

export interface LightkonePlugin {
  id: string;
  name: string;
  description?: string;
  /** Settings shown under the plugin in Settings, stored per device as "<plugin id>.<field name>". */
  settings?: Field[];
  storage?: StorageProvider[];
  lookups?: Lookup[];
  importers?: Importer[];
  actions?: PaperAction[];
}
