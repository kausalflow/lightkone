// Per-device settings, including storage credentials and API keys. They stay in
// this browser's localStorage and are never written into the library.

const KEY = "lightkone.settings";

export type Settings = Record<string, string>;

export function loadSettings(): Settings {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private window or storage blocked: settings last for this visit only
  }
}

/** Fields of one storage provider, e.g. "storage.s3.bucket" → { bucket }. */
export function storageConfig(s: Settings, provider: string): Record<string, string> {
  const prefix = `storage.${provider}.`;
  return Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
}

export const pluginUrls = (s: Settings): string[] => (s["plugins.urls"] ?? "").split(/\s+/).filter(Boolean);

/**
 * Ask the browser to keep this site's storage (settings, and the browser
 * library) even when space runs low. Returns whether it will.
 */
export async function persistStorage(): Promise<boolean> {
  try {
    const s = globalThis.navigator?.storage;
    if (!s?.persist) return false;
    return (await s.persisted()) || (await s.persist());
  } catch {
    return false;
  }
}

// Backups are a small JSON file. With a passphrase the settings are encrypted
// (AES-GCM, key from PBKDF2-SHA-256), since they hold keys and tokens.

const FORMAT = "lightkone-settings";
const ITERATIONS = 310_000;

interface Backup {
  format: typeof FORMAT;
  version: 1;
  exported: string;
  settings?: Settings;
  encrypted?: { salt: string; iv: string; data: string; iterations: number };
}

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function exportSettings(s: Settings, passphrase = "", now = new Date()): Promise<string> {
  const out: Backup = { format: FORMAT, version: 1, exported: now.toISOString() };
  if (passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFrom(passphrase, salt, ITERATIONS);
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(s))));
    out.encrypted = { salt: b64(salt), iv: b64(iv), data: b64(data), iterations: ITERATIONS };
  } else {
    out.settings = s;
  }
  return JSON.stringify(out, null, 2) + "\n";
}

/** Read a backup file. Throws with a readable message when it cannot. */
export async function importSettings(text: string, passphrase = ""): Promise<Settings> {
  let b: Backup;
  try {
    b = JSON.parse(text);
  } catch {
    throw new Error("This is not a Lightkone settings file.");
  }
  if (b?.format !== FORMAT) throw new Error("This is not a Lightkone settings file.");
  let s: unknown = b.settings;
  if (b.encrypted) {
    if (!passphrase) throw new Error("This backup is encrypted: enter its passphrase first.");
    const e = b.encrypted;
    try {
      const key = await keyFrom(passphrase, unb64(e.salt), e.iterations);
      s = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(e.iv) }, key, unb64(e.data))));
    } catch {
      throw new Error("Wrong passphrase, or the file is damaged.");
    }
  }
  if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error("The backup holds no settings.");
  return Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === "string")) as Settings;
}
