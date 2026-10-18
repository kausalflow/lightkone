import type { StorageAdapter } from "../core/types";
import { s3Storage, type S3Config } from "../plugins/storage-s3";
import { githubStorage, type GitHubConfig } from "../plugins/storage-github";

// A personal MCP address for anyone using the site. The person's own storage
// settings travel inside the address, encrypted with a key only the server
// has, so the site keeps no accounts and no copy of anyone's keys:
//
//   /mcp/u1.<base64url(iv | AES-GCM ciphertext of {"p": provider, "c": config})>
//
// Anyone who has the address can use the library it points to, like a share
// link. Revoking it means revoking the storage key or token inside it.

export const LINK_PREFIX = "u1.";
const FIELDS: Record<string, string[]> = {
  s3: ["endpoint", "bucket", "region", "prefix", "accessKeyId", "secretAccessKey"],
  github: ["repo", "token", "branch", "api"],
};
export const LINKABLE = Object.keys(FIELDS);

export interface LinkedStorage {
  provider: string;
  config: Record<string, string>;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function keyFor(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`lightkone-mcp-link:${secret}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Keep only the fields the provider uses, and check them. Throws with a readable message. */
export function cleanLink(provider: string, config: Record<string, unknown>): LinkedStorage {
  const fields = FIELDS[provider];
  if (!fields) throw new Error("Only a library in an S3/R2 bucket or a GitHub repository can be reached by AI apps.");
  const c: Record<string, string> = {};
  for (const f of fields) if (typeof config[f] === "string" && config[f]) c[f] = (config[f] as string).trim();
  for (const f of ["endpoint", "api"]) if (c[f] && !/^https:\/\//.test(c[f])) throw new Error(`The ${f} must start with https://.`);
  storageFor({ provider, config: c }); // throws when something required is missing
  return { provider, config: c };
}

export function storageFor(l: LinkedStorage): StorageAdapter {
  if (l.provider === "s3") return s3Storage(l.config as unknown as S3Config);
  if (l.provider === "github") return githubStorage(l.config as unknown as GitHubConfig);
  throw new Error(`Unknown storage ${l.provider}`);
}

export async function sealLink(l: LinkedStorage, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify({ p: l.provider, c: l.config }));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(secret), data));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return LINK_PREFIX + b64url(out);
}

/** The storage inside a personal address, or null when it is not one this server made. */
export async function openLink(token: string, secret: string): Promise<LinkedStorage | null> {
  if (!token.startsWith(LINK_PREFIX)) return null;
  try {
    const bytes = unb64url(token.slice(LINK_PREFIX.length));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, await keyFor(secret), bytes.subarray(12));
    const { p, c } = JSON.parse(new TextDecoder().decode(plain));
    return FIELDS[p] ? { provider: p, config: c } : null;
  } catch {
    return null;
  }
}
