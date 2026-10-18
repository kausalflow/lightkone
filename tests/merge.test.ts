import { describe, expect, it } from "vitest";
import { canonical, mergeLibraries } from "../src/core/merge";
import { Library, LIBRARY_PATH } from "../src/core/library";
import type { LibraryFile, Paper, StorageAdapter } from "../src/core/types";

const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], folders: [], added: "2026-01-01", fields: {}, ...p });
const lib = (papers: Paper[]): LibraryFile => ({ format: "lightkone-library", version: 1, papers });
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function shared(): StorageAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(p) { const v = files.get(p); return v === undefined ? null : new TextEncoder().encode(v); },
    async write(p, d) { files.set(p, typeof d === "string" ? d : new TextDecoder().decode(d)); },
    async list(prefix) { return [...files.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

describe("safe saves", () => {
  it("compares values whatever the order of their fields", () => {
    expect(canonical({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe(canonical({ a: [1, { d: 2 }], b: 1 }));
  });

  it("merges edits to different papers and fields, both ways", () => {
    const base = lib([paper("a"), paper("b"), paper("c"), paper("d")]);
    const ours = clone(base);
    ours.papers[0].notes = "mine";
    ours.papers[2].starred = true;
    ours.papers = ours.papers.filter((p) => p.id !== "d");
    ours.papers.push(paper("new-here"));
    const theirs = clone(base);
    theirs.papers[1].title = "Renamed there";
    theirs.papers[2].year = 2020;
    theirs.papers.push(paper("new-there"));
    const { file, fromThem } = mergeLibraries(base, ours, theirs);
    const by = new Map(file.papers.map((p) => [p.id, p]));
    expect(file.papers.map((p) => p.id)).toEqual(["a", "b", "c", "new-there", "new-here"]);
    expect(by.get("a")!.notes).toBe("mine");
    expect(by.get("b")!.title).toBe("Renamed there");
    expect(by.get("c")).toMatchObject({ starred: true, year: 2020 });
    expect(fromThem).toBe(3); // b, c, new-there
  });

  it("merges tags and folders as sets, and keeps a paper edited on one side and removed on the other", () => {
    const base = lib([paper("a", { tags: ["x", "y"], folders: ["P"] }), paper("b")]);
    const ours = clone(base);
    ours.papers[0].tags = ["x", "mine"];
    ours.papers = ours.papers.filter((p) => p.id !== "b");
    const theirs = clone(base);
    theirs.papers[0].tags = ["x", "y", "theirs"];
    theirs.papers[0].folders = ["P", "Q"];
    theirs.papers[1].notes = "edited there";
    const { file } = mergeLibraries(base, ours, theirs);
    expect(file.papers[0].tags.sort()).toEqual(["mine", "theirs", "x"]);
    expect(file.papers[0].folders).toEqual(["P", "Q"]);
    expect(file.papers[1]).toMatchObject({ id: "b", notes: "edited there" });
  });

  it("lets this device win only where both changed the same field", () => {
    const base = lib([paper("a", { notes: "old" })]);
    const ours = clone(base);
    ours.papers[0].notes = "mine";
    const theirs = clone(base);
    theirs.papers[0].notes = "theirs";
    expect(mergeLibraries(base, ours, theirs).file.papers[0].notes).toBe("mine");
  });

  it("two devices saving in turn keep each other's changes", async () => {
    const storage = shared();
    const first = new Library(storage);
    await first.load();
    first.merge([{ title: "Paper one from the laptop" }]);
    await first.save();

    const phone = new Library(storage);
    const laptop = new Library(storage);
    await phone.load();
    await laptop.load();
    phone.merge([{ title: "Added on the phone" }]);
    laptop.update(laptop.papers[0].id, { notes: "Written on the laptop" });
    expect(await phone.save()).toBe(0);
    expect(await laptop.save()).toBe(1); // took the phone's new paper
    const saved = JSON.parse(storage.files.get(LIBRARY_PATH)!) as LibraryFile;
    expect(saved.papers.map((p) => p.title).sort()).toEqual(["Added on the phone", "Paper one from the laptop"]);
    expect(saved.papers.find((p) => p.title.startsWith("Paper one"))!.notes).toBe("Written on the laptop");

    // The phone picks up the laptop's note without saving anything.
    expect(await phone.refresh()).toBe(1);
    expect(phone.papers.find((p) => p.title.startsWith("Paper one"))!.notes).toBe("Written on the laptop");
    const before = storage.files.get(LIBRARY_PATH);
    expect(await phone.save()).toBe(0);
    expect(storage.files.get(LIBRARY_PATH)).toBe(before);
  });
});
