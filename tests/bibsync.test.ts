import { describe, expect, it } from "vitest";
import { bibFor, defaultBibPath, papersInFolder, runBibSync } from "../src/core/bibsync";
import { Library, LIBRARY_PATH } from "../src/core/library";
import type { Paper, StorageAdapter } from "../src/core/types";

const paper = (over: Partial<Paper>): Paper => ({ id: over.key ?? "x", key: "k", type: "article", title: "T", authors: ["A, B"], year: 2020, tags: [], added: "2026-01-01T00:00:00Z", fields: {}, ...over });
const papers = [
  paper({ key: "b2", folders: ["Physics/QFT"] }),
  paper({ key: "a1", folders: ["Physics"] }),
  paper({ key: "c3", folders: ["PhysicsEdu"] }),
  paper({ key: "d4", folders: ["Physics"], trashed: "2026-02-01T00:00:00Z" }),
];

function memory(): StorageAdapter & { files: Map<string, string>; writes: number } {
  const files = new Map<string, string>();
  const s = {
    files,
    writes: 0,
    async read(p: string) { return files.has(p) ? new TextEncoder().encode(files.get(p)!) : null; },
    async write(p: string, d: Uint8Array | string) { s.writes++; files.set(p, typeof d === "string" ? d : new TextDecoder().decode(d)); },
    async list() { return []; },
  };
  return s;
}

describe("BibTeX sync", () => {
  it("takes a folder with its subfolders, sorted by key, without the trash", () => {
    expect(papersInFolder(papers, "physics").map((p) => p.key)).toEqual(["b2", "a1"]);
    expect(papersInFolder(papers, "").map((p) => p.key)).toEqual(["b2", "a1", "c3"]);
    const bib = bibFor(papers, "Physics");
    expect(bib.indexOf("{a1,")).toBeLessThan(bib.indexOf("{b2,"));
    expect(bib).toContain("% Physics: 2 papers");
    expect(bib).not.toContain("d4");
    expect(defaultBibPath("Physics/QFT")).toBe("physics-qft.bib");
    expect(defaultBibPath("")).toBe("library.bib");
  });

  it("writes only what changed, and reports failures per file", async () => {
    const repo = memory();
    const targets = [{ folder: "Physics", repo: "me/thesis", path: "refs.bib" }];
    expect((await runBibSync(targets, papers, () => repo)).written).toEqual(["me/thesis/refs.bib"]);
    expect((await runBibSync(targets, papers, () => repo)).unchanged).toBe(1);
    expect(repo.writes).toBe(1);
    const failing = await runBibSync(targets, papers, () => { throw new Error("GitHub 403"); });
    expect(failing.errors).toEqual(["me/thesis/refs.bib: GitHub 403"]);
  });

  it("keeps sync targets in library.json", async () => {
    const s = memory();
    const lib = new Library();
    lib.storage = s;
    lib.bibSync = [{ folder: "Physics", repo: "me/thesis", path: "refs.bib" }];
    await lib.save();
    expect(JSON.parse(s.files.get(LIBRARY_PATH)!).bibSync).toHaveLength(1);
    const again = new Library();
    again.storage = s;
    await again.load();
    expect(again.bibSync).toEqual(lib.bibSync);
  });
});
