import type { PaperDraft, StorageAdapter } from "./types";
import type { Source } from "./ask";
import type { Scope } from "./scope";

// Everything asked of Claude, kept in one place: questions to the library or
// beyond it, explanations and questions about a paper, tables, weighings
// and review drafts. Each conversation is its own file, so two devices never
// overwrite each other's; a small index lists them all for the History panel
// and for the papers they touch.

export const HISTORY_DIR = "lightkone/history/";
export const HISTORY_INDEX = `${HISTORY_DIR}index.json`;
export const conversationPath = (id: string) => `${HISTORY_DIR}${id}.json`;

export type Kind = "ask" | "beyond" | "paper" | "explain" | "table" | "weigh" | "review";

export const KINDS: Record<Kind, string> = {
  ask: "Ask",
  beyond: "Beyond the library",
  paper: "About a paper",
  explain: "Explain",
  table: "Table",
  weigh: "Agree or disagree",
  review: "Review draft",
};

export interface Turn {
  role: "user" | "assistant";
  text: string;
  /** For Ask: the passages given with this question, as Claude read them. */
  sources?: string;
}

/** What the History panel lists: enough to find a conversation and the papers it touched. */
export interface Entry {
  id: string;
  kind: Kind;
  title: string;
  created: string;
  updated: string;
  /** Library papers it is about or cites. */
  papers: string[];
  /** The start of the last answer. */
  preview: string;
}

export interface Conversation extends Entry {
  turns: Turn[];
  /** Ask: the numbered passages, for citations to open. */
  sources?: Source[];
  /** Ask beyond the library: the papers found, so any can still be added. */
  outside?: { id: string; draft: PaperDraft; cited?: number }[];
  scope?: Scope;
  /** About a paper or Explain: which paper, and the page and passage explained. */
  paperId?: string;
  page?: number;
  quote?: string;
  /** Compare: the table, weighing or draft as it was left. */
  data?: unknown;
}

interface Index {
  format: "lightkone-history";
  version: 1;
  entries: Entry[];
  /** Ids deleted on some device, so a merge doesn't bring them back. */
  removed?: string[];
}

const empty = (): Index => ({ format: "lightkone-history", version: 1, entries: [] });

/** A new conversation id, sortable by time: "20261021-0829-k3x9q". */
export function newConversationId(now = new Date()): string {
  const d = now.toISOString();
  return `${d.slice(0, 10).replace(/-/g, "")}-${d.slice(11, 16).replace(":", "")}-${Math.random().toString(36).slice(2, 7)}`;
}

/** The entry for a conversation, as listed. */
export function entryOf(c: Conversation): Entry {
  const d = c.data as { weighing?: { summary?: string }; draft?: string } | undefined;
  const last = [...c.turns].reverse().find((t) => t.role === "assistant")?.text ?? d?.weighing?.summary ?? d?.draft ?? "";
  return { id: c.id, kind: c.kind, title: c.title, created: c.created, updated: c.updated, papers: [...new Set(c.papers)], preview: last.replace(/\s+/g, " ").slice(0, 220) };
}

/** Two indexes as one: every conversation either has, the newer copy of each, none that either deleted. */
export function mergeIndex(a: Index, b: Index): Index {
  const removed = [...new Set([...(a.removed ?? []), ...(b.removed ?? [])])].slice(-2000);
  const gone = new Set(removed);
  const byId = new Map<string, Entry>();
  for (const e of [...a.entries, ...b.entries]) {
    if (gone.has(e.id)) continue;
    const had = byId.get(e.id);
    if (!had || had.updated < e.updated) byId.set(e.id, e);
  }
  return { ...empty(), entries: [...byId.values()].sort((x, y) => (x.updated < y.updated ? 1 : -1)), removed };
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

async function readIndex(storage: StorageAdapter): Promise<Index> {
  const bytes = await storage.read(HISTORY_INDEX).catch(() => null);
  if (!bytes) return empty();
  try {
    const raw = JSON.parse(text(bytes)) as Index;
    return raw?.format === "lightkone-history" && Array.isArray(raw.entries) ? raw : empty();
  } catch {
    return empty();
  }
}

/** Every conversation kept, newest first. */
export async function loadHistory(storage: StorageAdapter): Promise<Entry[]> {
  return mergeIndex(await readIndex(storage), empty()).entries;
}

export async function loadConversation(storage: StorageAdapter, id: string): Promise<Conversation | null> {
  const bytes = await storage.read(conversationPath(id)).catch(() => null);
  if (!bytes) return null;
  try {
    return JSON.parse(text(bytes)) as Conversation;
  } catch {
    return null;
  }
}

/** Keep a conversation, and list it, merging with what another device listed meanwhile. Returns the list. */
export async function saveConversation(storage: StorageAdapter, c: Conversation): Promise<Entry[]> {
  await storage.write(conversationPath(c.id), JSON.stringify(c), "application/json");
  const next = mergeIndex(await readIndex(storage), { ...empty(), entries: [entryOf(c)] });
  await storage.write(HISTORY_INDEX, JSON.stringify(next), "application/json");
  return next.entries;
}

export async function removeConversation(storage: StorageAdapter, id: string): Promise<Entry[]> {
  const next = mergeIndex(await readIndex(storage), { ...empty(), removed: [id] });
  await storage.write(HISTORY_INDEX, JSON.stringify(next), "application/json");
  await storage.remove?.(conversationPath(id)).catch(() => {});
  return next.entries;
}

/** Conversations whose title, answer or kind has every word typed. */
export function findEntries(entries: Entry[], q: string, kind?: Kind | "", paperId?: string): Entry[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(
    (e) =>
      (!kind || e.kind === kind) &&
      (!paperId || e.papers.includes(paperId)) &&
      words.every((w) => `${e.title} ${e.preview} ${KINDS[e.kind]}`.toLowerCase().includes(w)),
  );
}

/** "Today", "Yesterday", "Tuesday 14 Oct", for grouping the list. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: days < 7 ? "long" : undefined, day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** A conversation as Markdown, for notes: the questions as headings, citations named. */
export function conversationMarkdown(c: Conversation, name: (paperId: string, page: number) => string): string {
  const out = [`# ${c.title}`, "", `*${KINDS[c.kind]}, ${c.created.slice(0, 10)}*`, ""];
  if (c.quote) out.push(`> ${c.quote.replace(/\n/g, "\n> ")}`, "");
  const cite = (s: string) =>
    s.replace(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g, (whole, list: string) => {
      const names = list.split(/\s*[,;]\s*/).map((n) => c.sources?.find((x) => x.n === Number(n)));
      return names.every(Boolean) ? `(${names.map((x) => name(x!.paperId, x!.page)).join("; ")})` : whole;
    });
  c.turns.forEach((t, i) => {
    if (t.role === "user") out.push(i === 0 ? "" : `## ${t.text}`, "");
    else out.push(cite(t.text), "");
  });
  return out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n").trim() + "\n";
}

/** A History store kept in this browser, for shared or read-only libraries: your questions stay yours. */
export function browserHistoryStore(namespace: string): StorageAdapter {
  const key = (path: string) => `lightkone.history.${namespace}:${path}`;
  return {
    async read(path) {
      try {
        const v = localStorage.getItem(key(path));
        return v === null ? null : new TextEncoder().encode(v);
      } catch {
        return null;
      }
    },
    async write(path, data) {
      try {
        localStorage.setItem(key(path), typeof data === "string" ? data : new TextDecoder().decode(data));
      } catch {
        // full or private: this conversation isn't kept
      }
    },
    async list(prefix) {
      const out: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!;
          if (k.startsWith(key(prefix))) out.push(k.slice(key("").length));
        }
      } catch {
        // private window
      }
      return out;
    },
    async remove(path) {
      try {
        localStorage.removeItem(key(path));
      } catch {
        // private window
      }
    },
  };
}
