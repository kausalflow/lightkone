import { describe, expect, it } from "vitest";
import { candidatesFor, citeCommand, citeKeysIn, papersForKeys, parseVerdicts } from "../src/core/writing";
import { joinPages } from "../src/core/fulltext";
import type { Paper } from "../src/core/types";

const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], added: "2026-01-01", fields: {}, ...p });

describe("writing helpers", () => {
  it("reads every citation key from LaTeX, skipping comments", () => {
    const tex = String.raw`As in \cite{Wilson1971, Jumper2021} and \citep[see][p.~3]{Kadanoff1966}.
\textcite{Wilson1971} showed \parencite*{Fisher1974}. % \cite{Commented}
\nocite{Extra} 50\% of \citet{Last}`;
    expect(citeKeysIn(tex)).toEqual(["Wilson1971", "Jumper2021", "Kadanoff1966", "Fisher1974", "Extra", "Last"]);
  });

  it("matches keys to papers and lists the missing ones", () => {
    const papers = [paper("Wilson1971"), paper("jumper2021"), paper("Gone", { trashed: "2026-01-01" })];
    const { found, missing } = papersForKeys(papers, ["Wilson1971", "Jumper2021", "Gone", "Nope"]);
    expect(found.map((p) => p.key)).toEqual(["Wilson1971", "jumper2021"]);
    expect(missing).toEqual(["Gone", "Nope"]);
  });

  it("finds candidates with their passages, and reads Claude's verdicts", () => {
    const papers = [paper("a", { title: "Critical phenomena" }), paper("b", { title: "Protein folding", abstract: "Deep learning predicts structures." })];
    const texts = new Map([["a", joinPages(["Intro.", "The renormalization group flow has a fixed point at the critical temperature."])]]);
    const c = candidatesFor(papers, texts, "The RG flow has a fixed point at criticality");
    expect(c.map((x) => x.paper.id)).toEqual(["a"]);
    expect(c[0].passages[0].page).toBe(2);
    expect(citeCommand(["a", "b"], "citep")).toBe("\\citep{a,b}");
    expect(parseVerdicts('Here: [{"n":1,"support":"supports","quote":"fixed point"},{"n":2,"support":"maybe"},{"n":3,"support":"no","quote":" "}]')).toEqual([
      { n: 1, support: "supports", quote: "fixed point" },
      { n: 3, support: "no", quote: undefined },
    ]);
    expect(parseVerdicts("not json")).toEqual([]);
  });
});
