import { describe, expect, it } from "vitest";
import { Library, makeKey, LIBRARY_PATH, BIB_PATH } from "../src/core/library";
import { search, parseQuery } from "../src/core/search";
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

describe("Library", () => {
  it("dedupes by DOI, arXiv id and title, and fills in missing fields", () => {
    const lib = new Library();
    lib.merge([{ title: "Deep residual learning for image recognition", arxiv: "1512.03385v1", tags: ["vision"] }]);
    const { added, updated } = lib.merge([
      { title: "Deep Residual Learning for Image Recognition", doi: "10.1109/CVPR.2016.90", tags: ["resnet"] },
      { title: "Something else", arxiv: "arXiv:1512.03385" },
    ]);
    expect(added).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(lib.papers).toHaveLength(1);
    expect(lib.papers[0].doi).toBe("10.1109/CVPR.2016.90");
    expect(lib.papers[0].tags).toEqual(["vision", "resnet"]);
  });

  it("makes unique Paperpile-style keys", () => {
    const taken = new Set<string>();
    const d = { title: "Attention is all you need", authors: ["Vaswani, Ashish"], year: 2017 };
    const a = makeKey(d, taken);
    taken.add(a);
    const b = makeKey(d, taken);
    expect(a).toBe("Vaswani2017-an");
    expect(b).not.toBe(a);
  });

  it("saves JSON plus a .bib and loads it back, merging seeded papers once", async () => {
    const storage = memoryStorage();
    storage.seed = async () => [{ title: "From the Paperpile sync", key: "Pp2020-ab", year: 2020 }];
    const lib = new Library(storage);
    expect(await lib.load()).toEqual({ loaded: 0, seeded: 1, foldered: 0 });
    lib.merge([{ title: "Added by hand", authors: ["Noether, Emmy"], year: 1918 }]);
    await lib.save();
    expect(storage.files.has(LIBRARY_PATH)).toBe(true);
    expect(new TextDecoder().decode(storage.files.get(BIB_PATH))).toContain("@article{Noether1918-");

    const again = new Library(storage);
    expect(await again.load()).toEqual({ loaded: 2, seeded: 0, foldered: 0 });
  });
});

describe("search", () => {
  const lib = new Library();
  lib.merge([
    { title: "Renormalization group and critical phenomena", authors: ["Wilson, Kenneth G."], year: 1983, tags: ["physics"] },
    { title: "Neural ordinary differential equations", authors: ["Chen, Ricky T. Q."], year: 2018, tags: ["ml"], abstract: "We introduce a new family of deep neural network models" },
    { title: "Deep learning and the renormalization group", authors: ["Mehta, Pankaj"], year: 2014, tags: ["ml", "physics"] },
  ]);

  it("needs every word and ranks title hits first", () => {
    expect(search(lib.papers, "renormalization").map((p) => p.year)).toEqual(expect.arrayContaining([1983, 2014]));
    expect(search(lib.papers, "deep renormalization").map((p) => p.year)).toEqual([2014]);
  });

  it("filters by tag, author and year range", () => {
    expect(search(lib.papers, 'tag:"physics" year:2000-2020').map((p) => p.year)).toEqual([2014]);
    expect(search(lib.papers, "author:wilson")).toHaveLength(1);
    expect(search(lib.papers, "has:abstract")).toHaveLength(1);
  });

  it("finds what is missing with no:", () => {
    expect(search(lib.papers, "no:abstract")).toHaveLength(2);
    // A file path from Paperpile counts for has:pdf, but only a PDF in storage clears no:pdf.
    const p = { ...lib.papers[0], file: "All Papers/WILSON/Wilson 1983.pdf" };
    expect(search([p], "has:pdf")).toHaveLength(1);
    expect(search([p], "no:pdf")).toHaveLength(1);
    expect(search([{ ...p, pdf: "papers/All Papers/WILSON/Wilson 1983.pdf" }], "no:pdf")).toHaveLength(0);
  });

  it("parses quoted filters", () => {
    expect(parseQuery('tag:"machine learning" neural')).toMatchObject({ tags: ["machine learning"], words: ["neural"] });
  });
});
