import { describe, expect, it } from "vitest";
import { inTurn, keysIn, paperText, parseColumns, parseRow, parseWeighing, reviewSources, silentPapers, toCsv, toLatex, weighingMarkdown } from "../src/core/compare";
import type { Paper } from "../src/core/types";
import type { Source } from "../src/core/ask";

const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], added: "2026-01-01", fields: {}, ...p });

describe("a table of papers", () => {
  it("reads the PDF's text when there is one, the abstract otherwise, and cuts long papers", () => {
    expect(paperText(paper("a", { abstract: "Short." }), "[page 1]\nLong text").full).toBe(true);
    expect(paperText(paper("a", { abstract: "Short." }), undefined)).toEqual({ text: "Abstract: Short.", full: false, cut: false });
    expect(paperText(paper("a"), "x".repeat(50), 10)).toMatchObject({ text: "x".repeat(10), cut: true });
  });

  it("takes columns separated by commas, semicolons or lines", () => {
    expect(parseColumns("Method, Data;Main result\nMethod\n")).toEqual(["Method", "Data", "Main result"]);
  });

  it("reads a row in the columns' order, whatever order Claude gives", () => {
    const reply = 'Here it is:\n```json\n{"cells": [{"column": "data", "value": "Planck 2018", "page": 4, "quote": "we use Planck"}, {"column": "Method", "value": "MCMC", "page": "x"}]}\n```';
    expect(parseRow(reply, ["Method", "Data", "Error bars"])).toEqual([
      { value: "MCMC", page: 0, quote: undefined },
      { value: "Planck 2018", page: 4, quote: "we use Planck" },
      { value: "—", page: 0, quote: undefined },
    ]);
    expect(parseRow("no json", ["Method"])).toBeNull();
  });

  it("exports CSV and a LaTeX table, escaping what needs it but not math", () => {
    const byId = new Map([["a", paper("a", { title: 'A "quoted", title', authors: ["Smith, Jo"], year: 2020, key: "Smith2020" })]]);
    const rows = [{ paperId: "a", cells: [{ value: "50% of $H_0$", page: 3 }] }];
    const csv = toCsv(rows, ["Result"], byId);
    expect(csv.split("\r\n")[0]).toBe("Title,Authors,Year,Key,DOI,arXiv,Result,Result (page)");
    expect(csv.split("\r\n")[1]).toBe('"A ""quoted"", title","Smith, Jo",2020,Smith2020,,,50% of $H_0$,3');
    const tex = toLatex(rows, ["Result"], byId);
    expect(tex).toContain("Smith (2020) \\cite{Smith2020} & 50\\% of $H_0$ \\\\");
  });

  it("works a few papers at a time, and stops when asked", async () => {
    const seen: number[] = [];
    let running = 0;
    let most = 0;
    await inTurn([1, 2, 3, 4, 5], 2, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(n);
      running--;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(most).toBe(2);
    const stop = new AbortController();
    const done: number[] = [];
    await inTurn([1, 2, 3], 1, async (n) => { done.push(n); stop.abort(); }, stop.signal);
    expect(done).toEqual([1]);
  });
});

describe("where papers agree or disagree", () => {
  const sources: Source[] = [
    { n: 1, paperId: "a", page: 2, text: "..." },
    { n: 2, paperId: "b", page: 0, text: "..." },
  ];
  it("keeps points with a known stance and known sources", () => {
    const w = parseWeighing('{"summary": "They differ on the prior.", "points": [{"stance": "supports", "text": "A finds it.", "sources": [1, 9]}, {"stance": "maybe", "text": "x", "sources": [2]}]}', new Set([1, 2]));
    expect(w).toEqual({ summary: "They differ on the prior.", points: [{ stance: "supports", text: "A finds it.", sources: [1] }] });
    const papers = [paper("a", { authors: ["Smith, Jo"], year: 2020 }), paper("b"), paper("c")];
    expect(silentPapers(papers, w!.points, sources).map((p) => p.id)).toEqual(["b", "c"]);
    const md = weighingMarkdown("The claim", w!, sources, new Map(papers.map((p) => [p.id, p])));
    expect(md).toContain("## Supports\n\n- A finds it. (Smith 2020, p. 2)");
  });
});

describe("a review draft", () => {
  it("gives Claude each paper's key and abstract, or the opening of its text", () => {
    const s = reviewSources([paper("a", { key: "Smith2020", abstract: "We measure." }), paper("b", { key: "Doe2021" })], new Map([["b", "[page 1]\nIntroduction  here"]]));
    expect(s).toContain('<paper key="Smith2020">');
    expect(s).toContain("Abstract: We measure.");
    expect(s).toContain("Opening of the text: Introduction here");
  });

  it("finds the keys a draft cites, in LaTeX and in pandoc Markdown", () => {
    expect(keysIn("As shown \\citep[p.~3]{Smith2020, Doe2021} and \\cite{Lee-2019}.")).toEqual(["Smith2020", "Doe2021", "Lee-2019"]);
    expect(keysIn("Shown before [@Smith2020; @Doe2021, p. 4]. Mail me at x@y.org.")).toEqual(["Smith2020", "Doe2021"]);
  });
});
