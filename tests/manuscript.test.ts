import { describe, expect, it } from "vitest";
import { guesses, manuscriptBib, rawEntries, syncManuscript } from "../src/core/manuscript";
import { folderTargets, runBibSync } from "../src/core/bibsync";
import type { BibTarget, Paper, StorageAdapter } from "../src/core/types";

const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], added: "2026-01-01", fields: {}, ...p });

function memory(files: Record<string, string>): StorageAdapter & { files: Record<string, string>; writes: number } {
  const enc = new TextEncoder();
  const m = {
    files,
    writes: 0,
    async read(p: string) { return p in files ? enc.encode(files[p]) : null; },
    async write(p: string, d: Uint8Array | string) { m.writes++; files[p] = typeof d === "string" ? d : new TextDecoder().decode(d); },
    async list(prefix: string) { return Object.keys(files).filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/")); },
    async listAll(prefix: string) { return Object.keys(files).filter((f) => f.startsWith(prefix)); },
  };
  return m;
}

const library = [
  paper("1", { key: "Riess1998-ab", title: "Observational evidence from supernovae", authors: ["Riess, Adam G."], year: 1998 }),
  paper("2", { key: "Planck2018", title: "Planck 2018 results", authors: ["Aghanim, N."], year: 2018 }),
  paper("3", { key: "Unused", title: "Not cited" }),
];
const target: BibTarget = { folder: "", repo: "me/paper", path: "paper/refs.bib", tex: "paper" };

describe("watch my manuscript", () => {
  it("reads the entries of a .bib as written", () => {
    const bib = "@comment{x}\n@article{Old2001, title={Braces {inside}}, year=2001}\n\n@misc{b, note={}}";
    expect([...rawEntries(bib)]).toEqual([["Old2001", "@article{Old2001, title={Braces {inside}}, year=2001}"], ["b", "@misc{b, note={}}"]]);
  });

  it("guesses which paper a key means from its surname and year", () => {
    expect(guesses(library, "riess1998").map((p) => p.id)).toEqual(["1"]);
    expect(guesses(library, "Riess:1998xy").map((p) => p.id)).toEqual(["1"]);
    expect(guesses(library, "riess1999")).toEqual([]);
  });

  it("holds exactly what is cited: library papers, hand-matched keys, and old entries it can't replace", () => {
    const tex = ["Dark energy \\citep{riess1998-AB, Planck2018}. % \\cite{Unused}\n", "\\input{x} \\cite[p.~3]{Old2001,Peebles1993,smith2020}"];
    const old = "@book{Old2001, title={Kept as written}}\n@article{Gone, title={No longer cited}}";
    const { text, report } = manuscriptBib(library, tex, { ...target, aliases: { Peebles1993: "2" } }, old);
    expect(report.keys).toEqual(["riess1998-AB", "Planck2018", "Old2001", "Peebles1993", "smith2020"]);
    expect([...rawEntries(text).keys()]).toEqual(["Old2001", "Peebles1993", "Planck2018", "riess1998-AB"]);
    expect(text).toContain("@book{Old2001, title={Kept as written}}");
    expect(text).not.toContain("Gone");
    expect(text).not.toContain("Unused");
    expect(report).toMatchObject({ inBib: 4, kept: ["Old2001"], missing: [{ key: "smith2020", maybe: [] }] });
  });

  it("writes the .bib only when it changes, and leaves it alone when nothing is cited", async () => {
    const repo = memory({ "paper/main.tex": "\\input{sections/intro}", "paper/sections/intro.tex": "\\cite{Planck2018}", "other/x.tex": "\\cite{Unused}" });
    const first = await syncManuscript(target, library, repo);
    expect(first.written).toBe(true);
    expect(first.report.texFiles).toEqual(["paper/main.tex", "paper/sections/intro.tex"]);
    expect([...rawEntries(repo.files["paper/refs.bib"]).keys()]).toEqual(["Planck2018"]);
    expect((await syncManuscript(target, library, repo)).written).toBe(false);
    expect(repo.writes).toBe(1);

    const empty = memory({ "paper/main.tex": "No citations yet.", "paper/refs.bib": "@misc{Mine, title={x}}" });
    expect((await syncManuscript(target, library, empty)).written).toBe(false);
    expect(empty.files["paper/refs.bib"]).toBe("@misc{Mine, title={x}}");
  });

  it("is synced with the folder .bib files, which ignore it", async () => {
    const repo = memory({ "paper/main.tex": "\\cite{Riess1998-ab}" });
    const folder: BibTarget = { folder: "", repo: "me/paper", path: "library.bib" };
    const r = await runBibSync([folder, target], library, () => repo);
    expect(r.written).toEqual(["me/paper/library.bib", "me/paper/paper/refs.bib"]);
    expect(r.manuscripts.get("me/paper/paper/refs.bib")?.inBib).toBe(1);
    expect(folderTargets([folder, target], "")).toEqual([folder]);
  });
});
