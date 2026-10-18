// POST /api/mcp-link {provider, config}: a personal MCP address for a library
// kept in the person's own S3/R2 bucket or GitHub repository. The address
// carries their storage settings, encrypted with this site's MCP_SECRET (or
// MCP_TOKEN when there is no MCP_SECRET); nothing is stored here.

import { cleanLink, sealLink, storageFor } from "../../src/mcp/link";
import { LIBRARY_PATH } from "../../src/core/library";

interface Env {
  MCP_SECRET?: string;
  MCP_TOKEN?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const linkSecret = (env: Env) => [env.MCP_SECRET, env.MCP_TOKEN].find((s) => s && s.length >= 24);

export async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Use POST." }, 405);
  const secret = linkSecret(env);
  if (!secret) return json({ error: "This site has not turned on AI app access yet: its host needs to set MCP_SECRET (see docs/MCP.md)." }, 503);
  let body: { provider?: string; config?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send JSON." }, 400);
  }
  try {
    const link = cleanLink(String(body.provider ?? ""), body.config ?? {});
    // Try the keys once, so a typo shows up now rather than inside Claude.
    await storageFor(link).read(LIBRARY_PATH);
    const url = `${new URL(request.url).origin}/mcp/${await sealLink(link, secret)}`;
    return json({ url });
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
}

export const onRequest = ({ request, env }: { request: Request; env: Env }) => handle(request, env);
