import { describe, expect, it } from "vitest";
import { findInText, TextIndex } from "../src/core/textsearch";
import { joinPages, textPath } from "../src/core/fulltext";
import { search } from "../src/core/search";
import type { Paper, StorageAdapter } from "../src/core/types";

const text = joinPages(["Introduction. We study the Ising model.", "The renormalization group flow has a fixed point at the critical temperature."]);

function memory(files: Record<string, string | Uint8Array> = {}): StorageAdapter & { files: Map<string, Uint8Array | string> } {
  const m = new Map<string, Uint8Array | string>(Object.entries(files));
  return {
    files: m,
    async read(p) { const v = m.get(p); return v === undefined ? null : typeof v === "string" ? new TextEncoder().encode(v) : v; },
    async write(p, d) { m.set(p, d); },
    async list(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
  };
}
const noLocal = { get: async () => null, put: async () => {} };
const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], added: "2026-01-01", fields: {}, ...p });

describe("full-text search", () => {
  it("finds every word, with the page and a snippet", () => {
    expect(findInText(text, ["fixed point", "ising"])).toEqual({ page: 2, snippet: "The renormalization group flow has a fixed point at the critical temperature." });
    expect(findInText(text, ["ising", "boson"])).toBeNull();
    expect(findInText(text, ["ising"])?.page).toBe(1);
  });

  it("loads stored texts and adds papers that match only inside", async () => {
    const storage = memory({ [textPath("a")]: text });
    const index = new TextIndex(storage, "ns", noLocal);
    await index.load(() => {});
    const papers = [paper("a"), paper("b", { title: "Fixed point theorems" })];
    const found = search(papers, "fixed point", "added", (id, w) => index.hit(id, w) !== null);
    expect(found.map((p) => p.id)).toEqual(["b", "a"]);
    expect(search(papers, "fixed point").map((p) => p.id)).toEqual(["b"]);
  });

  it("reads PDFs that have no text yet", async () => {
    const storage = memory({ "pdfs/a.pdf": new Uint8Array([1]), "pdfs/b.pdf": new Uint8Array([2]) });
    const index = new TextIndex(storage, "ns", noLocal);
    const papers = [paper("a", { pdf: "pdfs/a.pdf" }), paper("b", { pdf: "pdfs/b.pdf" }), paper("c")];
    expect(index.missing(papers).map((p) => p.id)).toEqual(["a", "b"]);
    const progress: number[] = [];
    await index.indexPdfs(papers, async (bytes) => (bytes[0] === 1 ? ["page one about bosons"] : [""]), (d) => progress.push(d));
    expect(progress).toEqual([1, 2]);
    expect(index.hit("a", ["boson"])?.page).toBe(1);
    expect(storage.files.has(textPath("a"))).toBe(true);
    expect(storage.files.has(textPath("b"))).toBe(false); // a scanned PDF with no text
  });
});
