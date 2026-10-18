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
