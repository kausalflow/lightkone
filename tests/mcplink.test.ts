import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanLink, openLink, sealLink } from "../src/mcp/link";
import { parseListing } from "../src/plugins/storage-s3";
import { handle } from "../functions/api/mcp-link";
import { onRequest } from "../functions/mcp/[token]";

const SECRET = "x".repeat(32);
const s3 = { endpoint: "https://acc.r2.cloudflarestorage.com", bucket: "papers", accessKeyId: "AKID", secretAccessKey: "SECRET" };

afterEach(() => vi.unstubAllGlobals());

describe("personal MCP addresses", () => {
  it("round-trips the storage settings and hides them", async () => {
    const token = await sealLink(cleanLink("s3", s3), SECRET);
    expect(token.startsWith("u1.")).toBe(true);
    expect(token).not.toContain("SECRET");
    expect(token).toMatch(/^u1\.[\w-]+$/);
    expect(await openLink(token, SECRET)).toEqual({ provider: "s3", config: s3 });
  });

  it("refuses another server's address or a changed one", async () => {
    const token = await sealLink(cleanLink("github", { repo: "me/lib", token: "t" }), SECRET);
    expect(await openLink(token, "y".repeat(32))).toBeNull();
    expect(await openLink(token.slice(0, -2) + (token.endsWith("A") ? "BB" : "AA"), SECRET)).toBeNull();
    expect(await openLink("not-a-link", SECRET)).toBeNull();
  });

  it("keeps only known fields and checks them", () => {
    expect(cleanLink("github", { repo: "me/lib", token: "t", bibFolder: "pp", extra: "x" }).config).toEqual({ repo: "me/lib", token: "t" });
    expect(() => cleanLink("browser", {})).toThrow(/S3\/R2 bucket or a GitHub repository/);
    expect(() => cleanLink("s3", { ...s3, endpoint: "http://10.0.0.1" })).toThrow(/https/);
    expect(() => cleanLink("s3", { endpoint: s3.endpoint })).toThrow();
  });
});

describe("/api/mcp-link", () => {
  const post = (body: unknown) => new Request("https://lk.example/api/mcp-link", { method: "POST", body: JSON.stringify(body) });

  it("needs a server secret", async () => {
    const r = await handle(post({ provider: "s3", config: s3 }), {});
    expect(r.status).toBe(503);
  });

  it("tries the storage, then returns an address that works", async () => {
    // An empty bucket: every read is a 404, listings are empty.
    const fetch = vi.fn(async (req: Request | string) => {
      const url = typeof req === "string" ? req : req.url;
      return url.includes("list-type") ? new Response("<ListBucketResult></ListBucketResult>") : new Response("", { status: 404 });
    });
    vi.stubGlobal("fetch", fetch);
    const r = await handle(post({ provider: "s3", config: s3 }), { MCP_SECRET: SECRET });
    const { url } = await r.json();
    expect(r.status).toBe(200);
    expect(url).toMatch(/^https:\/\/lk\.example\/mcp\/u1\./);
    expect(String(fetch.mock.calls[0][0] instanceof Request ? fetch.mock.calls[0][0].url : fetch.mock.calls[0][0])).toContain("/papers/lightkone/library.json");

    const token = url.split("/mcp/")[1];
    const rpc = new Request(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const res = await onRequest({ request: rpc, env: { MCP_SECRET: SECRET }, params: { token } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain("search_papers");
  });

  it("says what is wrong with the storage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    const r = await handle(post({ provider: "s3", config: s3 }), { MCP_TOKEN: SECRET });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/403/);
  });

  it("is 404 for an unknown address", async () => {
    const res = await onRequest({ request: new Request("https://lk.example/mcp/u1.abc", { method: "POST" }), env: { MCP_SECRET: SECRET }, params: { token: "u1.abc" } });
    expect(res.status).toBe(404);
  });
});

describe("S3 listings without DOMParser", () => {
  it("reads keys, escapes and the next page", () => {
    const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>a/R&amp;D.pdf</Key><Size>1</Size></Contents><Contents><Key>b.txt</Key></Contents><NextContinuationToken>tok&#43;1</NextContinuationToken></ListBucketResult>`;
    expect(parseListing(xml)).toEqual({ keys: ["a/R&D.pdf", "b.txt"], next: "tok+1" });
    expect(parseListing("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>")).toEqual({ keys: [], next: null });
  });
});
