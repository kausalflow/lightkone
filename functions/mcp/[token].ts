// Lightkone's MCP server at /mcp/<token>, as a Cloudflare Pages Function.
// Two kinds of address (see docs/MCP.md):
// - a personal address made in Settings, which carries that person's own
//   storage settings encrypted (src/mcp/link.ts), for anyone using the site;
// - the host's own: MCP_TOKEN, over the R2 bucket bound as LIBRARY.

import { handleHttp } from "../../src/mcp/server";
import { openLink, storageFor } from "../../src/mcp/link";
import { linkSecret } from "../api/mcp-link";
import type { StorageAdapter } from "../../src/core/types";

interface R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
}
interface Env {
  LIBRARY?: R2Bucket;
  MCP_TOKEN?: string;
  MCP_SECRET?: string;
}

function r2Storage(bucket: R2Bucket): StorageAdapter {
  return {
    async read(path) {
      const o = await bucket.get(path);
      return o ? new Uint8Array(await o.arrayBuffer()) : null;
    },
    async write(path, data, contentType) {
      await bucket.put(path, data, { httpMetadata: { contentType } });
    },
    async list(prefix) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix, cursor });
        keys.push(...page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return keys;
    },
  };
}

/** Compare without leaking how much of the token matched. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const onRequest = async ({ request, env, params }: { request: Request; env: Env; params: { token: string } }) => {
  const secret = linkSecret(env);
  const linked = secret ? await openLink(String(params.token), secret) : null;
  if (linked) return handleHttp(request, storageFor(linked));
  if (!env.MCP_TOKEN || env.MCP_TOKEN.length < 24 || !same(String(params.token), env.MCP_TOKEN)) return new Response("Not found", { status: 404 });
  if (!env.LIBRARY) return new Response("Bind the library's R2 bucket to this Pages project as LIBRARY (see docs/MCP.md).", { status: 500 });
  return handleHttp(request, r2Storage(env.LIBRARY));
};
