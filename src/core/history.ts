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
  /** What you named it; the first question otherwise. */
  name?: string;
  pinned?: boolean;
  /** Your own labels, to gather chats on one subject. */
  topics?: string[];
  /** The papers it was asked of, when chosen; the whole library or beyond it otherwise. */
  focus?: string[] | "library" | "beyond";
  /** When it was last renamed, pinned or labelled. */
  edited?: string;
}

/** What a conversation was about: the paper or papers chosen, or the library, or beyond it. */
export function focusOf(c: Pick<Conversation, "kind" | "papers" | "paperId" | "scope" | "focus">): string[] | "library" | "beyond" {
  if (c.focus) return c.focus;
  if (c.kind === "beyond") return "beyond";
  if (c.paperId) return [c.paperId];
  if (c.scope?.kind === "picked") return [...c.scope.ids];
  if (c.kind === "table" || c.kind === "weigh" || c.kind === "review") return c.papers.length ? [...c.papers] : "library";
  if (c.kind === "paper" || c.kind === "explain") return c.papers.length ? [...c.papers] : "library";
  return "library";
}

/** The title shown: your name for it, or its first question. */
export const titleOf = (e: Entry) => e.name?.trim() || e.title;

export type Organize = Partial<Pick<Entry, "name" | "pinned" | "topics">>;

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
  const e: Entry = { id: c.id, kind: c.kind, title: c.title, created: c.created, updated: c.updated, papers: [...new Set(c.papers)], preview: last.replace(/\s+/g, " ").slice(0, 220), focus: focusOf(c) };
  if (c.name) e.name = c.name;
  if (c.pinned) e.pinned = true;
  if (c.topics?.length) e.topics = c.topics;
  if (c.edited) e.edited = c.edited;
  return e;
}

const stamp = (e: Entry) => (e.edited && e.edited > e.updated ? e.edited : e.updated);

/** Two indexes as one: every conversation either has, the newer copy of each, none that either deleted. */
export function mergeIndex(a: Index, b: Index): Index {
  const removed = [...new Set([...(a.removed ?? []), ...(b.removed ?? [])])].slice(-2000);
  const gone = new Set(removed);
  const byId = new Map<string, Entry>();
  for (const e of [...a.entries, ...b.entries]) {
    if (gone.has(e.id)) continue;
    const had = byId.get(e.id);
    if (!had || stamp(had) < stamp(e)) byId.set(e.id, e);
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
  const index = await readIndex(storage);
  // A follow-up keeps the name, pin and topics given to the conversation meanwhile.
  const had = index.entries.find((e) => e.id === c.id);
  if (had) c = { ...c, name: c.name ?? had.name, pinned: c.pinned ?? had.pinned, topics: c.topics ?? had.topics, edited: c.edited ?? had.edited };
  await storage.write(conversationPath(c.id), JSON.stringify(c), "application/json");
  const next = mergeIndex(index, { ...empty(), entries: [entryOf(c)] });
  await storage.write(HISTORY_INDEX, JSON.stringify(next), "application/json");
  return next.entries;
}

/** Rename, pin or label a conversation. */
export async function organizeConversation(storage: StorageAdapter, id: string, change: Organize, now = new Date().toISOString()): Promise<Entry[]> {
  const c = await loadConversation(storage, id);
  if (!c) return loadHistory(storage);
  const next: Conversation = { ...c, ...change, edited: now };
  if (!next.name?.trim()) delete next.name;
  if (!next.pinned) delete next.pinned;
  if (!next.topics?.length) delete next.topics;
  await storage.write(conversationPath(id), JSON.stringify(next), "application/json");
  const index = mergeIndex(await readIndex(storage), { ...empty(), entries: [entryOf(next)] });
  // The edited copy wins over the one listed, even if it had no name or pin left.
  index.entries = index.entries.map((e) => (e.id === id ? entryOf(next) : e));
  await storage.write(HISTORY_INDEX, JSON.stringify(index), "application/json");
  return index.entries;
}

export async function removeConversation(storage: StorageAdapter, id: string): Promise<Entry[]> {
  const next = mergeIndex(await readIndex(storage), { ...empty(), removed: [id] });
  await storage.write(HISTORY_INDEX, JSON.stringify(next), "application/json");
  await storage.remove?.(conversationPath(id)).catch(() => {});
  return next.entries;
}

/** Conversations whose name, question, answer, kind or topics have every word typed. */
export function findEntries(entries: Entry[], q: string, kind?: Kind | "", paperId?: string, topic?: string): Entry[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(
    (e) =>
      (!kind || e.kind === kind) &&
      (!paperId || e.papers.includes(paperId) || (Array.isArray(e.focus) && e.focus.includes(paperId))) &&
      (!topic || e.topics?.includes(topic)) &&
      words.every((w) => `${e.name ?? ""} ${e.title} ${e.preview} ${KINDS[e.kind]} ${(e.topics ?? []).join(" ")}`.toLowerCase().includes(w)),
  );
}

export type GroupBy = "papers" | "date" | "topic";

export interface Group {
  key: string;
  label: string;
  /** For a group of papers: which, so a new chat can start on them. */
  papers?: string[];
  entries: Entry[];
}

/**
 * Conversations gathered for the list: by the paper or set of papers they
 * were about (the library, beyond it), by day, or by topic. Pinned ones come
 * first; groups with the latest conversation next.
 */
export function groupEntries(entries: Entry[], by: GroupBy, name: (ids: string[]) => string, now = new Date()): Group[] {
  const groups = new Map<string, Group>();
  const put = (key: string, label: string, e: Entry, papers?: string[]) => {
    const g = groups.get(key) ?? { key, label, papers, entries: [] };
    g.entries.push(e);
    groups.set(key, g);
  };
  const pinned = entries.filter((e) => e.pinned);
  for (const e of entries) {
    if (by === "date") put(`d:${dayLabel(e.updated, now)}`, dayLabel(e.updated, now), e);
    else if (by === "topic") {
      if (!e.topics?.length) put("t:", "No topic", e);
      for (const t of e.topics ?? []) put(`t:${t}`, t, e);
    } else {
      const f = e.focus ?? focusOf({ ...e, turns: [] } as unknown as Conversation);
      if (f === "library") put("library", "Whole library", e);
      else if (f === "beyond") put("beyond", "Beyond the library", e);
      else {
        const ids = [...new Set(f)].sort();
        put(`p:${ids.join(",")}`, name(ids), e, ids);
      }
    }
  }
  const latest = (g: Group) => g.entries.reduce((m, e) => (e.updated > m ? e.updated : m), "");
  const list = [...groups.values()].sort((a, b) => Number(a.key === "t:") - Number(b.key === "t:") || latest(b).localeCompare(latest(a)));
  return pinned.length ? [{ key: "pinned", label: "Pinned", entries: pinned }, ...list] : list;
}

/** Every topic used, most used first. */
export function topicsOf(entries: Entry[]): string[] {
  const n = new Map<string, number>();
  for (const e of entries) for (const t of e.topics ?? []) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
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
