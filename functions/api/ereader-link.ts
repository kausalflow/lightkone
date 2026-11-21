// POST /api/ereader-link {provider, config}: the address of a personal e-reader
// catalog (OPDS) for a library kept in the person's own S3/R2 bucket or GitHub
// repository. Like the AI app address (mcp-link.ts) it carries their storage
// settings encrypted with this site's MCP_SECRET, but it can only list and
// download the files sent to the e-reader. When the host has bound a KV
// namespace as LINKS, the answer also has a short address, easier to type on
// an e-reader: a random code standing for the long one, kept in LINKS.

import { cleanLink, sealLink, storageFor } from "../../src/mcp/link";
import { linkSecret } from "./mcp-link";
import { LIBRARY_PATH } from "../../src/core/library";

interface KV {
  put(key: string, value: string): Promise<void>;
}
interface Env {
  MCP_SECRET?: string;
  MCP_TOKEN?: string;
  LINKS?: KV;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// No 0/1/i/l/o, which look alike on small screens.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function shortCode(random: Uint8Array = crypto.getRandomValues(new Uint8Array(10))): string {
  return Array.from(random, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const secret = linkSecret(env);
  if (!secret) return json({ error: "This site has not turned on outside access yet: its host needs to set MCP_SECRET (see docs/MCP.md)." }, 503);
  let body: { provider?: string; config?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send JSON." }, 400);
  }
  try {
    const link = { ...cleanLink(String(body.provider ?? ""), body.config ?? {}), scope: "opds" as const };
    // Try the keys once, so a typo shows up now rather than on the reader.
    await storageFor(link).read(LIBRARY_PATH);
    const token = await sealLink(link, secret);
    const origin = new URL(request.url).origin;
    let short: string | undefined;
    if (env.LINKS) {
      const code = shortCode();
      await env.LINKS.put(`opds:${code}`, token);
      short = `${origin}/opds/${code}`;
    }
    return json({ url: `${origin}/opds/${token}`, short });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}

export const onRequest = ({ request, env }: { request: Request; env: Env }) => handle(request, env);
