import type { Field, Paper, StorageAdapter } from "./types";
import type { Settings } from "./settings";
import { storageConfig } from "./settings";
import { Library } from "./library";

// Shared libraries: a library that lives where a group can reach it (a private
// GitHub repository, or a bucket), opened next to one's own. Who may read and
// who may write is decided there, by the repository's collaborators or by the
// keys handed out, so Lightkone needs no accounts of its own. On each device
// a shared library's address and credentials stay in the browser's settings.

export interface SharedLibrary {
  id: string;
  name: string;
  /** A storage provider id: github, s3. */
  provider: string;
  config: Record<string, string>;
}

/** What an invite link carries: everything but secrets. */
export interface Invite {
  name: string;
  provider: string;
  config: Record<string, string>;
}

export const sharedLibraries = (s: Settings): SharedLibrary[] => {
  try {
    const list = JSON.parse(s["libraries.shared"] ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

export const withShared = (s: Settings, list: SharedLibrary[]): Settings => ({ ...s, "libraries.shared": JSON.stringify(list) });

/** The library open now: "" for one's own, else a shared library's id. */
export const activeId = (s: Settings) => (sharedLibraries(s).some((l) => l.id === s["libraries.active"]) ? s["libraries.active"] : "");

/** Where the open library lives. */
export function activeStorage(s: Settings): { providerId: string; config: Record<string, string>; shared: SharedLibrary | null } {
  const shared = sharedLibraries(s).find((l) => l.id === activeId(s)) ?? null;
  if (shared) return { providerId: shared.provider, config: shared.config, shared };
  const providerId = s["storage.provider"] || "browser";
  return { providerId, config: storageConfig(s, providerId), shared: null };
}

/** An invite link for a shared library, without its token or secret key. */
export function inviteLink(base: string, l: SharedLibrary, fields: Field[]): string {
  const secret = new Set(fields.filter((f) => f.type === "password").map((f) => f.name));
  const config = Object.fromEntries(Object.entries(l.config).filter(([k, v]) => v && !secret.has(k)));
  const data: Invite = { name: l.name, provider: l.provider, config };
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set("join", btoa(unescape(encodeURIComponent(JSON.stringify(data)))));
  return url.toString();
}

/** The invite in a link's ?join=, or null. */
export function readInvite(search: string): Invite | null {
  const raw = new URLSearchParams(search).get("join");
  if (!raw) return null;
  try {
    const d = JSON.parse(decodeURIComponent(escape(atob(raw)))) as Invite;
    if (typeof d.name !== "string" || typeof d.provider !== "string" || typeof d.config !== "object" || !d.config) return null;
    // Only plain strings: an invite can't carry code or nested values.
    const config = Object.fromEntries(Object.entries(d.config).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    return { name: d.name.slice(0, 80), provider: d.provider, config };
  } catch {
    return null;
  }
}

/** A short id for a new shared library. */
export const newSharedId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 8);

/** Copy papers, with their PDFs, into another library. Returns how many were new there. */
export async function copyPapers(papers: Paper[], from: StorageAdapter, to: StorageAdapter, by?: string): Promise<number> {
  const target = new Library(to);
  await target.load();
  const drafts = papers.map(({ id: _id, pdf: _pdf, opened: _opened, starred: _starred, trashed: _trashed, added: _added, ...rest }) => ({ ...rest, ...(by ? { by } : {}) }));
  const { added } = target.merge(drafts);
  for (const p of added) {
    const source = papers.find((x) => x.key === p.key || x.title === p.title);
    if (!source?.pdf) continue;
    const bytes = await from.read(source.pdf);
    if (!bytes) continue;
    await to.write(source.pdf, bytes, "application/pdf");
    p.pdf = source.pdf;
  }
  if (added.length) await target.save();
  return added.length;
}
