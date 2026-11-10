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

const call = (s: StorageAdapter, name: string, args: object, resolve?: any, fetchFn?: any) =>
  handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, s, resolve, fetchFn) as Promise<any>;
const text = (r: any) => r.result.content[0].text as string;

describe("MCP server", () => {
  it("initializes and lists tools", async () => {
    const s = memoryStorage();
    const init: any = await handleRpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18" } }, s);
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.capabilities.tools).toBeDefined();
    const list: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, s);
    expect(list.result.tools.map((t: any) => t.name)).toEqual([
      "search_papers", "get_paper", "read_paper", "list_tags", "search_full_text", "get_citations", "find_missing_papers", "list_branches", "export_bibtex",
      "add_paper", "tag_papers", "add_note",
    ]);
    expect(init.result.capabilities.prompts).toBeDefined();
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

  it("searches inside full texts, narrowed by a query", async () => {
    const { s, id } = await seeded();
    const hit = JSON.parse(text(await call(s, "search_full_text", { words: "TWO text" })));
    expect(hit.papers).toHaveLength(1);
    expect(hit.papers[0]).toMatchObject({ id, page: 2 });
    expect(hit.papers[0].snippet).toContain("Page two text");
    expect(JSON.parse(text(await call(s, "search_full_text", { words: "page", within: "tag:vision" }))).papers).toEqual([]);
    expect((await call(s, "search_full_text", { words: " " })).result.isError).toBe(true);
  });

  it("answers from the citation map and finds what the library keeps citing", async () => {
    const { s, id } = await seeded();
    const lib = JSON.parse(new TextDecoder().decode(s.files.get(LIBRARY_PATH)!));
    const other = lib.papers.find((p: any) => p.id !== id);
    expect(text(await call(s, "get_citations", { paper: id }))).toMatch(/open the citation map/);
    const at = "2026-11-01T00:00:00Z";
    await s.write(
      "lightkone/citations.json",
      JSON.stringify({ format: "lightkone-citations", version: 1, works: { [id]: { oa: "W1", refs: ["W2", "W9"], at }, [other.id]: { oa: "W2", refs: ["W9"], at } } }),
    );
    const c = JSON.parse(text(await call(s, "get_citations", { paper: id })));
    expect(c.cites.map((p: any) => p.id)).toEqual([other.id]);
    expect(c.cited_by).toEqual([]);
    const asked: string[] = [];
    const fetchFn = async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ results: [{ id: "https://openalex.org/W9", title: "Layer Normalization", publication_year: 2016, doi: "https://doi.org/10.48550/arxiv.1607.06450", authorships: [{ author: { display_name: "Jimmy Ba" } }] }] }));
    };
    const m = JSON.parse(text(await call(s, "find_missing_papers", {}, undefined, fetchFn)));
    expect(asked[0]).toContain("openalex:W9");
    expect(m.missing).toEqual([{ openalex: "W9", title: "Layer Normalization", authors: ["Ba, Jimmy"], year: 2016, arxiv: "1607.06450", cited_by_library: expect.arrayContaining([other.key]) }]);
  });

  it("lists kept Branches with their saved candidates", async () => {
    const { s } = await seeded();
    expect(text(await call(s, "list_branches", {}))).toMatch(/No Branches/);
    await s.write("lightkone/branches.json", JSON.stringify({ format: "lightkone-branches", version: 1, items: [{ id: "b1", name: "Whole library", scope: "library", roots: [], seen: [], made: "2026-11-01" }] }));
    expect(JSON.parse(text(await call(s, "list_branches", {})))[0].candidates).toMatch(/Not opened yet/);
    await s.write(
      "lightkone/branches/library.json",
      JSON.stringify({
        format: "lightkone-branch-result", version: 1, at: "2026-11-02", scope: "library", roots: [], library: true,
        candidates: [{ oa: "W5", draft: { title: "Layer Normalization", authors: ["Ba, Jimmy"], arxiv: "1607.06450" }, year: 2016, cited: 9000, refs: [], citesRoots: ["W1"], citedByRoots: [], shared: 3, libraryLinks: [], score: 1 }],
      }),
    );
    const [b] = JSON.parse(text(await call(s, "list_branches", { branch: "whole" })));
    expect(b).toMatchObject({ name: "Whole library", grows_from: "the whole library", results_from: "2026-11-02" });
    expect(b.candidates[0]).toMatchObject({ title: "Layer Normalization", cited_by_count: 9000, cites_roots: 1, shared_references: 3 });
    expect((await call(s, "list_branches", { branch: "nope" })).result.isError).toBe(true);
  });

  it("exports BibTeX by key or by query", async () => {
    const { s } = await seeded();
    const all = text(await call(s, "export_bibtex", { query: "" }));
    expect(all.match(/^@/gm)).toHaveLength(2);
    expect(text(await call(s, "export_bibtex", { query: "tag:vision" }))).toContain("Deep Residual Learning");
    expect((await call(s, "export_bibtex", {})).result.isError).toBe(true);
  });

  it("offers prompts", async () => {
    const s = memoryStorage();
    const list: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "prompts/list" }, s);
    expect(list.result.prompts.map((p: any) => p.name)).toEqual(["find_in_library", "cite_draft", "reading_gaps", "explain_paper"]);
    const got: any = await handleRpc({ jsonrpc: "2.0", id: 2, method: "prompts/get", params: { name: "cite_draft", arguments: { text: "Attention helps." } } }, s);
    expect(got.result.messages[0].content.text).toContain("Attention helps.");
    expect(got.result.messages[0].content.text).toContain("\\cite{key}");
    const lacking: any = await handleRpc({ jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "cite_draft", arguments: {} } }, s);
    expect(lacking.error.code).toBe(-32602);
  });
});
