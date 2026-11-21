import type { StorageAdapter } from "./types";

// The personal addresses made in Settings (the AI app address and the e-reader
// catalog), kept in the library so they show again after a reload and on every
// device, instead of a new one being made each time. Each is kept against the
// storage settings it was made for (as a hash, never the settings themselves),
// so changing the storage shows no stale address. The addresses carry the
// storage keys only encrypted, with a key only the site has.

export const LINKS_PATH = "lightkone/links.json";

export type LinkKind = "mcp" | "opds";

export interface KeptLink {
  url: string;
  short?: string;
  made: string;
}

type LinksFile = Record<string, Partial<Record<LinkKind, KeptLink>>>;

/** A short hash of the storage settings an address was made for. */
export async function linkKey(where: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lightkone-link:${where}`)));
  return Array.from(digest.subarray(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readLinks(storage: StorageAdapter): Promise<LinksFile> {
  const raw = await storage.read(LINKS_PATH).catch(() => null);
  if (!raw) return {};
  try {
    const body = JSON.parse(new TextDecoder().decode(raw));
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

/** The address of this kind kept for these storage settings, if one was made. */
export async function keptLink(storage: StorageAdapter, kind: LinkKind, where: string): Promise<KeptLink | null> {
  const links = await readLinks(storage);
  const kept = links[await linkKey(where)]?.[kind];
  return kept?.url ? kept : null;
}

/** Keeps an address for these storage settings, replacing the one made before. */
export async function keepLink(storage: StorageAdapter, kind: LinkKind, where: string, link: Omit<KeptLink, "made">, now = new Date()): Promise<void> {
  const links = await readLinks(storage);
  const key = await linkKey(where);
  links[key] = { ...links[key], [kind]: { ...link, made: now.toISOString() } };
  await storage.write(LINKS_PATH, JSON.stringify(links, null, 1), "application/json");
}
