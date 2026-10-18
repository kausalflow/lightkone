import { describe, expect, it } from "vitest";
import { cleanFolder, folderTree, foldersFromPaperpile } from "../src/core/folders";
import { search } from "../src/core/search";
import { Library, LIBRARY_PATH } from "../src/core/library";
import type { Paper, StorageAdapter } from "../src/core/types";

const paper = (over: Partial<Paper>): Paper => ({ id: Math.random().toString(36), key: "k", type: "article", title: "T", authors: [], tags: [], added: "2026-01-01T00:00:00Z", fields: {}, ...over });

describe("folders", () => {
  it("reads the user's folders from Paperpile paths, not its author folders", () => {
    expect(foldersFromPaperpile("All Papers/MLDS/MachineLearning/NeuralNetworks/Hinton et al. 2012 - x.pdf")).toEqual(["MLDS/MachineLearning/NeuralNetworks"]);
    expect(foldersFromPaperpile("All Papers/HINTON/Hinton et al. 2012 - x.pdf")).toEqual([]);
    expect(foldersFromPaperpile("All Papers/SJÖSTRAND/x.pdf")).toEqual([]);
    expect(foldersFromPaperpile("All Papers/Other/People have the AI power.pdf")).toEqual([]);
    expect(foldersFromPaperpile("All Papers/timeseries/x.pdf")).toEqual(["timeseries"]);
    expect(foldersFromPaperpile("All Papers/HINTON/a.pdf;All Papers/MLDS/Statistics/a.pdf")).toEqual(["MLDS/Statistics"]);
    expect(foldersFromPaperpile(undefined)).toEqual([]);
    expect(cleanFolder(" Physics / QFT/ ")).toBe("Physics/QFT");
  });

  it("builds a tree that counts each paper once per folder, outside the trash", () => {
    const tree = folderTree([
      paper({ folders: ["Physics/QFT", "Physics/Stat"] }),
      paper({ folders: ["Physics"] }),
      paper({ folders: ["ML"], trashed: "2026-01-02T00:00:00Z" }),
    ]);
    expect(tree.map((n) => [n.path, n.count])).toEqual([["Physics", 2]]);
    expect(tree[0].children.map((n) => [n.path, n.count])).toEqual([["Physics/QFT", 1], ["Physics/Stat", 1]]);
  });

  it("filters by folder, star, recent and trash", () => {
    const ps = [
      paper({ title: "a", folders: ["Physics/QFT"], starred: true }),
      paper({ title: "b", folders: ["Physics"], opened: "2026-03-01T00:00:00Z" }),
      paper({ title: "c", folders: ["PhysicsEdu"], opened: "2026-04-01T00:00:00Z" }),
      paper({ title: "d", trashed: "2026-01-02T00:00:00Z", folders: ["Physics"] }),
    ];
    const titles = (q: string) => search(ps, q).map((p) => p.title);
    expect(titles('in:"physics"').sort()).toEqual(["a", "b"]);
    expect(titles("in:Physics/QFT")).toEqual(["a"]);
    expect(titles("is:starred")).toEqual(["a"]);
    expect(titles("is:recent")).toEqual(["c", "b"]);
    expect(titles("is:trash")).toEqual(["d"]);
    expect(titles("").sort()).toEqual(["a", "b", "c"]);
  });

  it("gives existing Paperpile papers their folders once when the library loads", async () => {
    const files = new Map<string, Uint8Array>();
    const s: StorageAdapter = {
      read: async (p) => files.get(p) ?? null,
      write: async (p, d) => void files.set(p, typeof d === "string" ? new TextEncoder().encode(d) : d),
      list: async () => [],
    };
    const old = [paper({ title: "x", file: "All Papers/MLDS/Statistics/x.pdf" }), paper({ title: "y", file: "All Papers/BERGER/y.pdf" }), paper({ title: "z", folders: [] , file: "All Papers/MLDS/z.pdf"})];
    await s.write(LIBRARY_PATH, JSON.stringify({ format: "lightkone-library", version: 1, papers: old }));
    const lib = new Library();
    lib.storage = s;
    expect((await lib.load()).foldered).toBe(1);
    expect(lib.papers.map((p) => p.folders)).toEqual([["MLDS/Statistics"], [], []]);
  });
});
