import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadName, opdsAnswer, opdsFeed } from "../src/core/opds";
import { cleanLink, openLink, sealLink } from "../src/mcp/link";
import { handle as makeLink, shortCode } from "../functions/api/ereader-link";
import { handle as catalog } from "../functions/opds/[[path]]";
import { onRequest as mcp } from "../functions/mcp/[token]";
import type { Sent } from "../src/core/ereader";
import type { StorageAdapter } from "../src/core/types";

const SECRET = "x".repeat(32);
const s3 = { endpoint: "https://acc.r2.cloudflarestorage.com", bucket: "papers", accessKeyId: "AKID", secretAccessKey: "SECRET" };

const sent: Sent = {
  id: "p1",
  title: "Selective <state> spaces",
  authors: ["Albert Gu"],
  year: 2023,
  abstract: "About & more.",
  file: "lightkone/ereader/p1.epub",
  size: 3,
  sent: "2026-11-21T12:00:00.000Z",
  source: "arxiv",
};
const index = JSON.stringify({ version: 1, papers: [sent, { ...sent, id: "evil", file: "lightkone/library.json" }] });

function memory(files: Record<string, string>): StorageAdapter {
  return { read: async (p) => (p in files ? new TextEncoder().encode(files[p]) : null), write: async () => undefined, list: async () => [] };
}

afterEach(() => vi.unstubAllGlobals());

describe("the e-reader catalog feed", () => {
  it("lists sent papers with download links, escaped", () => {
    const xml = opdsFeed([sent], "https://lk.example/opds/abc");
    expect(xml).toContain('<link rel="http://opds-spec.org/acquisition" href="https://lk.example/opds/abc/p1.epub" type="application/epub+zip" length="3"/>');
    expect(xml).toContain("<title>Selective &lt;state&gt; spaces</title>");
    expect(xml).toContain("<summary type=\"text\">About &amp; more.</summary>");
    expect(xml).toContain("<author><name>Albert Gu</name></author>");
  });

  it("serves only listed files under lightkone/ereader/", async () => {
    const s = memory({ "lightkone/ereader.json": index, "lightkone/ereader/p1.epub": "PK!", "lightkone/library.json": "secret" });
    const feed = await opdsAnswer(s, "", "https://lk.example/opds/abc");
    expect(feed.headers.get("content-type")).toContain("profile=opds-catalog");
    const file = await opdsAnswer(s, "p1.epub", "https://lk.example/opds/abc");
    expect(file.headers.get("content-type")).toBe("application/epub+zip");
    expect(await file.text()).toBe("PK!");
    expect(file.headers.get("content-disposition")).toBe('attachment; filename="Selective state spaces.epub"');
    expect((await opdsAnswer(s, "evil.epub", "x")).status).toBe(404);
    expect((await opdsAnswer(s, "nope.epub", "x")).status).toBe(404);
    expect((await opdsAnswer(s, "../library.json", "x")).status).toBe(404);
    expect(downloadName({ ...sent, title: "Über: ∂ψ" })).toBe("Uber.epub");
  });
});

describe("e-reader catalog addresses", () => {
  // A bucket holding the sent list and one file.
  function bucket() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (req: Request | string) => {
        const url = typeof req === "string" ? req : req.url;
        if (url.endsWith("/lightkone/ereader.json")) return new Response(index);
        if (url.endsWith("/lightkone/ereader/p1.epub")) return new Response("PK!");
        if (url.endsWith("/lightkone/library.json")) return new Response("{}");
        return new Response("", { status: 404 });
      }),
    );
  }
  const post = (body: unknown) => new Request("https://lk.example/api/ereader-link", { method: "POST", body: JSON.stringify(body) });
  const get = (path: string) => new Request(`https://lk.example/opds/${path}`);

  it("makes a catalog-only address the reader can open", async () => {
    bucket();
    const r = await makeLink(post({ provider: "s3", config: s3 }), { MCP_SECRET: SECRET });
    const { url, short } = await r.json();
    expect(short).toBeUndefined();
    const token = url.split("/opds/")[1];
    expect(await openLink(token, SECRET)).toMatchObject({ scope: "opds" });

    const feed = await catalog(get(token), { MCP_SECRET: SECRET }, [token]);
    expect(feed.status).toBe(200);
    expect(await feed.text()).toContain(`https://lk.example/opds/${token}/p1.epub`);
    const file = await catalog(get(`${token}/p1.epub`), { MCP_SECRET: SECRET }, [token, "p1.epub"]);
    expect(await file.text()).toBe("PK!");

    // It can't be used as an AI app address.
    const rpc = new Request(`https://lk.example/mcp/${token}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect((await mcp({ request: rpc, env: { MCP_SECRET: SECRET }, params: { token } })).status).toBe(404);
  });

  it("refuses AI app addresses and unknown ones", async () => {
    bucket();
    const full = await sealLink(cleanLink("s3", s3), SECRET);
    expect((await catalog(get(full), { MCP_SECRET: SECRET }, [full])).status).toBe(404);
    expect((await catalog(get("u1.abc"), { MCP_SECRET: SECRET }, ["u1.abc"])).status).toBe(404);
    expect((await catalog(get("x"), {}, ["x"])).status).toBe(404);
  });

  it("gives a short address when the host keeps codes in KV", async () => {
    bucket();
    const kv = new Map<string, string>();
    const LINKS = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) };
    const r = await makeLink(post({ provider: "s3", config: s3 }), { MCP_SECRET: SECRET, LINKS });
    const { short } = await r.json();
    const code = short.split("/opds/")[1];
    expect(code).toMatch(/^[a-z2-9]{10}$/);
    const feed = await catalog(get(code), { MCP_SECRET: SECRET, LINKS }, [code]);
    expect(await feed.text()).toContain(`https://lk.example/opds/${code}/p1.epub`);
    expect((await catalog(get("zzzzzzzzzz"), { MCP_SECRET: SECRET, LINKS }, ["zzzzzzzzzz"])).status).toBe(404);
  });

  it("makes codes without look-alike characters", () => {
    expect(shortCode(new Uint8Array(10).fill(0))).toBe("aaaaaaaaaa");
    expect(shortCode(new Uint8Array([8, 11, 14, 30, 255, 1, 2, 3, 4, 5]))).not.toMatch(/[01ilo]/);
  });
});
