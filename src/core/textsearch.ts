import type { Paper, StorageAdapter } from "./types";
import { joinPages, textPath } from "./fulltext";

// Search inside papers. The text of each PDF is kept next to it in storage
// (lightkone/text/<id>.txt, written by the reader or by "Index PDFs"); this
// loads those files once per device, keeps a copy in the browser's Cache
// Storage so later visits read nothing from the network, and finds words in
// them with the page they are on.

const TEXT_DIR = "lightkone/text/";
const decoder = new TextDecoder();

export interface TextHit {
  page: number;
  snippet: string;
}

/** Where all the words occur in a text, with the page of the first and a snippet around it. Null unless every word is there. */
export function findInText(text: string, words: string[]): TextHit | null {
  if (!words.length) return null;
  const lower = text.toLowerCase();
  let first = -1;
  for (const w of words) {
    const at = lower.indexOf(w);
    if (at < 0) return null;
    if (first < 0) first = at;
  }
  const page = (text.slice(0, first).match(/\f/g)?.length ?? 0) + 1;
  const pageStart = text.lastIndexOf("\n\f\n", first);
  let start = Math.max(pageStart < 0 ? 0 : pageStart + 3, first - 80);
  if (start > pageStart + 3 && start > 0) start = Math.min(first, text.indexOf(" ", start) + 1 || start); // begin on a word
  const raw = text.slice(start, first + 140).replace(/^\[page \d+\]\s*/, "").replace(/\s+/g, " ").trim();
  return { page, snippet: `${start > pageStart + 3 && start > 0 ? "…" : ""}${raw}${first + 140 < text.length ? "…" : ""}` };
}

/** A small persistent copy of the texts in this browser, per library. */
interface LocalCopy {
  get(id: string): Promise<string | null>;
  put(id: string, text: string): Promise<void>;
}

function cacheCopy(ns: string): LocalCopy {
  const url = (id: string) => `https://lightkone.local/text/${encodeURIComponent(ns)}/${encodeURIComponent(id)}`;
  const box = () => (typeof caches === "undefined" ? Promise.reject(new Error("no cache")) : caches.open("lightkone-text"));
  return {
    async get(id) {
      try {
        const r = await (await box()).match(url(id));
        return r ? await r.text() : null;
      } catch {
        return null;
      }
    },
    async put(id, text) {
      try {
        await (await box()).put(url(id), new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } }));
      } catch {
        // private window: memory only
      }
    },
  };
}

export class TextIndex {
  readonly texts = new Map<string, string>();
  private local: LocalCopy;

  constructor(private storage: StorageAdapter, ns: string, local?: LocalCopy) {
    this.local = local ?? cacheCopy(ns);
  }

  /** Load every stored text, the local copy first. Calls onChange as texts arrive. */
  async load(onChange: () => void): Promise<void> {
    const keys = (await this.storage.list(TEXT_DIR).catch(() => [] as string[])).filter((k) => k.endsWith(".txt"));
    const ids = keys.map((k) => k.slice(TEXT_DIR.length, -4)).filter((id) => !this.texts.has(id));
    let since = 0;
    const tick = () => { if (++since >= 25) { since = 0; onChange(); } };
    await pool(ids, 6, async (id) => {
      let text = await this.local.get(id);
      if (text === null) {
        const bytes = await this.storage.read(textPath(id)).catch(() => null);
        if (!bytes) return;
        text = decoder.decode(bytes);
        await this.local.put(id, text);
      }
      this.texts.set(id, text);
      tick();
    });
    onChange();
  }

  /** Remember a text that was just written to storage. */
  async add(id: string, text: string): Promise<void> {
    this.texts.set(id, text);
    await this.local.put(id, text);
  }

  hit(id: string, words: string[]): TextHit | null {
    const t = this.texts.get(id);
    return t ? findInText(t, words) : null;
  }

  /** Papers with a PDF whose text has not been extracted yet. */
  missing(papers: Paper[]): Paper[] {
    return papers.filter((p) => p.pdf && !p.trashed && !this.texts.has(p.id));
  }

  /**
   * Extract and store the text of each PDF that has none, one at a time.
   * `extract` turns PDF bytes into page texts (pdf.js in the app).
   */
  async indexPdfs(papers: Paper[], extract: (bytes: Uint8Array) => Promise<string[]>, onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<number> {
    const todo = this.missing(papers);
    let done = 0;
    for (const p of todo) {
      if (signal?.aborted) break;
      try {
        const bytes = await this.storage.read(p.pdf!);
        const pages = bytes ? await extract(bytes) : [];
        if (pages.some((s) => s.trim())) {
          const text = joinPages(pages);
          await this.storage.write(textPath(p.id), text, "text/plain; charset=utf-8");
          await this.add(p.id, text);
        }
      } catch {
        // a broken or scanned PDF: skip it
      }
      onProgress(++done, todo.length);
    }
    return done;
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]).catch(() => {});
  }));
}
