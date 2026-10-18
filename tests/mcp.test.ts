import { describe, expect, it } from "vitest";
import { handleHttp, handleRpc } from "../src/mcp/server";
import { Library, LIBRARY_PATH } from "../src/core/library";
import { annotationsPath, serializeAnnotations } from "../src/core/annotations";
import { joinPages, textPath } from "../src/core/fulltext";
import type { StorageAdapter } from "../src/core/types";

function memoryStorage(): StorageAdapter & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const enc = new TextEncoder();
  return {
    files,
    async read(p) { return files.get(p) ?? null; },
    async write(p, d) { files.set(p, typeof d === "string" ? enc.encode(d) : d); },
    async list(prefix) { return [...files.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

async function seeded() {
  const s = memoryStorage();
  const lib = new Library();
  lib.storage = s;
  lib.merge([
    { title: "Attention Is All You Need", authors: ["Vaswani, Ashish"], year: 2017, arxiv: "1706.03762", tags: ["transformers"], abstract: "The dominant sequence transduction models" },
    { title: "Deep Residual Learning", authors: ["He, Kaiming"], year: 2016, tags: ["vision"] },
  ]);
  await lib.save();
  const id = lib.papers.find((p) => p.arxiv)!.id;
  await s.write(textPath(id), joinPages(["Page one text", "Page two text", "Page three"]));
  await s.write(annotationsPath(id), serializeAnnotations(id, [{ id: "h", page: 2, rects: [], text: "scaled dot-product", note: "key idea", created: "2026-10-18T00:00:00Z" }]));
  return { s, id };
}

const call = (s: StorageAdapter, name: string, args: object, resolve?: any) =>
  handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, s, resolve) as Promise<any>;
const text = (r: any) => r.result.content[0].text as string;

describe("MCP server", () => {
  it("initializes and lists tools", async () => {
    const s = memoryStorage();
    const init: any = await handleRpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, s);
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeDefined();
    const list: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, s);
    expect(list.result.tools.map((t: any) => t.name)).toEqual(["search_papers", "get_paper", "read_paper", "list_tags", "add_paper", "tag_papers", "add_note"]);
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" } as any, s)).toBeNull();
    expect(((await handleRpc({ jsonrpc: "2.0", id: 2, method: "nope" }, s)) as any).error.code).toBe(-32601);
  });

  it("searches, reads and returns highlights", async () => {
    const { s, id } = await seeded();
    const found = JSON.parse(text(await call(s, "search_papers", { query: "tag:transformers" })));
    expect(found.total).toBe(1);
    expect(found.papers[0].id).toBe(id);
    const paper = JSON.parse(text(await call(s, "get_paper", { paper: "arXiv:1706.03762" })));
    expect(paper.highlights).toEqual([{ page: 2, text: "scaled dot-product", note: "key idea" }]);
    expect(paper.bibtex).toContain("@article{");
    const read = text(await call(s, "read_paper", { paper: paper.key, from_page: 2, to_page: 2 }));
    expect(read).toContain("(3 pages)");
    expect(read).toContain("Page two text");
    expect(read).not.toContain("Page one text");
    const none = await call(s, "read_paper", { paper: "missing" });
    expect(none.result.isError).toBe(true);
  });

  it("adds, tags and annotates papers in storage", async () => {
    const { s } = await seeded();
    const resolve = async () => ({ title: "Fast dropout training", authors: ["Wang, Sida"], year: 2013, doi: "10.1234/x" });
    expect(text(await call(s, "add_paper", { identifier: "10.1234/x", tags: ["dropout"] }, resolve))).toMatch(/^Added/);
    expect(text(await call(s, "add_paper", { identifier: "10.1234/x" }, resolve))).toMatch(/^Already/);
    const lib = JSON.parse(new TextDecoder().decode(s.files.get(LIBRARY_PATH)!));
    const key = lib.papers.find((p: any) => p.title === "Fast dropout training").key;
    await call(s, "tag_papers", { papers: [key], add: ["regularization"], remove: ["dropout"] });
    await call(s, "add_note", { paper: key, text: "Compare with Wager 2013." });
    const after = JSON.parse(new TextDecoder().decode(s.files.get(LIBRARY_PATH)!)).papers.find((p: any) => p.key === key);
    expect(after.tags).toEqual(["regularization"]);
    expect(after.notes).toBe("Compare with Wager 2013.");
  });

  it("speaks HTTP: batches, notifications and bad JSON", async () => {
    const s = memoryStorage();
    const post = (body: string) => handleHttp(new Request("https://x/mcp/t", { method: "POST", body, headers: { "content-type": "application/json" } }), s);
    expect((await post('{"jsonrpc":"2.0","method":"notifications/initialized"}')).status).toBe(202);
    const batch = await (await post('[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"ping"}]')).json();
    expect(batch).toHaveLength(2);
    expect((await post("{nope")).status).toBe(400);
    expect((await handleHttp(new Request("https://x/mcp/t"), s)).status).toBe(405);
  });
});
