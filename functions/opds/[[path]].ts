// The e-reader catalog at /opds/<address>, as a Cloudflare Pages Function.
// <address> is either the sealed storage address made in Settings
// (src/mcp/link.ts, scope "opds"), or a short code standing for it when the
// host has bound a KV namespace as LINKS (short codes are easier to type on a
// reader's keyboard). See docs/EREADER.md and src/core/opds.ts.

import { openLink, storageFor } from "../../src/mcp/link";
import { linkSecret } from "../api/mcp-link";
import { wait } from "../api/_middleware";
import { opdsAnswer } from "../../src/core/opds";

interface KV {
  get(key: string): Promise<string | null>;
}
interface Env {
  MCP_SECRET?: string;
  MCP_TOKEN?: string;
  LINKS?: KV;
}

export const SHORT = /^[a-z2-9]{10}$/;

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function handle(request: Request, env: Env, path: string[]): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Use GET.", { status: 405 });
  const who = request.headers.get("cf-connecting-ip") ?? "unknown";
  const seconds = wait(`opds ${who}`, 60);
  if (seconds) return new Response(`Too many requests; try again in ${seconds} s.`, { status: 429, headers: { "retry-after": String(seconds) } });
  const [address = "", ...rest] = path;
  const secret = linkSecret(env);
  if (!secret || !address) return notFound();
  let token = address;
  if (SHORT.test(address)) token = (env.LINKS && (await env.LINKS.get(`opds:${address}`))) || "";
  const linked = token ? await openLink(token, secret) : null;
  if (!linked || linked.scope !== "opds") return notFound();
  const self = `${new URL(request.url).origin}/opds/${address}`;
  return opdsAnswer(storageFor(linked), rest.join("/"), self);
}

export const onRequest = ({ request, env, params }: { request: Request; env: Env; params: { path?: string | string[] } }) =>
  handle(request, env, Array.isArray(params.path) ? params.path : params.path ? [params.path] : []);
