import type { StorageAdapter } from "./types";

// Claude's answers, kept with the library so the same request is never paid
// for twice. Each answer is filed under a hash of exactly what was sent:
// the model, the instructions, the question and the passages, with a PDF
// standing in as a hash of its bytes. The same paper asked the same thing
// gets the saved answer at once; anything that changes the request (a new
// PDF, other passages, another model) asks Claude afresh. "Again" buttons
// skip the saved answer and replace it.

export const ANSWERS_DIR = "lightkone/answers/";
export const answerPath = (key: string) => `${ANSWERS_DIR}${key}.json`;

export interface SavedAnswer<T = unknown> {
  format: "lightkone-answer";
  version: 1;
  /** Which feature asked: summary, explain, ask, table-row, … */
  kind: string;
  model: string;
  /** When Claude answered. */
  at: string;
  value: T;
}

let store: StorageAdapter | null = null;
// This visit's answers, so a second look doesn't even read storage.
const memo = new Map<string, SavedAnswer>();

/** Where answers are kept: the library's storage, or this browser for a shared or read-only library. */
export function setAnswerStore(s: StorageAdapter | null) {
  if (s === store) return;
  store = s;
  memo.clear();
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/**
 * The key for a request: a hash of it, with each PDF or text document as a
 * hash of its contents and each picture left out (the passage it shows is
 * in the text beside it, and a picture differs with zoom), so the key stays
 * the same from one device or visit to the next.
 */
export async function requestKey(request: unknown): Promise<string> {
  const big: string[] = [];
  const json = JSON.stringify(request, (k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (v.type === "image") return { type: "image" };
      if (v.type === "base64" && typeof v.data === "string") {
        big.push(v.data);
        return { ...v, data: `#${big.length - 1}` };
      }
    }
    // What the API ignores for the answer.
    if (k === "cache_control") return undefined;
    return v;
  });
  const parts = await Promise.all(big.map(sha256));
  return sha256(`${json}\n${parts.join("\n")}`);
}

/** The answer kept for a request, if any. */
export async function recall<T>(key: string): Promise<SavedAnswer<T> | null> {
  const had = memo.get(key);
  if (had) return had as SavedAnswer<T>;
  if (!store) return null;
  const bytes = await store.read(answerPath(key)).catch(() => null);
  if (!bytes) return null;
  try {
    const a = JSON.parse(new TextDecoder().decode(bytes)) as SavedAnswer<T>;
    if (a?.format !== "lightkone-answer") return null;
    memo.set(key, a);
    return a;
  } catch {
    return null;
  }
}

/** Keep an answer. Never fails the request it came from. */
export async function remember<T>(key: string, kind: string, model: string, value: T, at = new Date().toISOString()): Promise<SavedAnswer<T>> {
  const a: SavedAnswer<T> = { format: "lightkone-answer", version: 1, kind, model, at, value };
  memo.set(key, a);
  await store?.write(answerPath(key), JSON.stringify(a), "application/json").catch(() => {});
  return a;
}

/** How a call uses saved answers. */
export interface Reuse {
  /** Ask Claude again, and keep the new answer in place of the saved one. */
  fresh?: boolean;
  /** Told when the answer is a saved one, with when Claude gave it. */
  onSaved?(at: string): void;
}

/** "saved 3 Nov", for a note beside a saved answer. */
export function savedLabel(at: string, now = new Date()): string {
  const d = new Date(at);
  const same = d.toDateString() === now.toDateString();
  return same
    ? `saved today at ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
    : `saved ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" })}`;
}

/** A file kept beside the answers (a tool's own saved state), read from where answers are kept. */
export async function readKept<T>(path: string): Promise<T | null> {
  if (!store) return null;
  const bytes = await store.read(path).catch(() => null);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

/** Keep a tool's state where answers are kept. Quiet when it can't. */
export async function writeKept(path: string, value: unknown): Promise<void> {
  await store?.write(path, JSON.stringify(value), "application/json").catch(() => {});
}
