import { describe, expect, it } from "vitest";
import { insertMention, mentionLabel, mentionMatches, mentionedPassages, mentionsAsNames, mentionsIn, openMention } from "../src/core/mentions";
import type { Paper } from "../src/core/types";

const paper = (id: string, p: Partial<Paper>): Paper => ({ id, key: id, type: "article", title: "", authors: [], tags: [], added: "2026-10-01T00:00:00Z", fields: {}, ...p });
const papers = [
  paper("Vaswani2017-ab", { title: "Attention Is All You Need", authors: ["Vaswani, Ashish", "Shazeer, Noam", "Parmar, Niki"], year: 2017, abstract: "The dominant sequence transduction models." }),
  paper("Wilson1974", { title: "The renormalization group and the epsilon expansion", authors: ["Wilson, Kenneth G.", "Kogut, John"], year: 1974 }),
  paper("Old", { title: "Gone", authors: ["Gone, A."], trashed: "2026-10-02T00:00:00Z" }),
];

describe("[[ mentions in a chat", () => {
  it("sees an open [[ before the caret, and not a closed one", () => {
    expect(openMention("compare with [[wil", 18)).toEqual({ start: 13, query: "wil" });
    expect(openMention("compare with [[Wilson1974]] and", 31)).toBeNull();
    expect(openMention("no brackets", 11)).toBeNull();
  });

  it("finds papers by author, title words, year or key, never trashed ones", () => {
    expect(mentionMatches(papers, "wilson").map((p) => p.id)).toEqual(["Wilson1974"]);
    expect(mentionMatches(papers, "attention 2017").map((p) => p.id)).toEqual(["Vaswani2017-ab"]);
    expect(mentionMatches(papers, "gone")).toEqual([]);
    expect(mentionMatches(papers, "")).toHaveLength(2);
  });

  it("puts [[key]] in place of what was typed", () => {
    expect(insertMention("compare with [[wil", 18, 13, "Wilson1974")).toEqual({ text: "compare with [[Wilson1974]] ", caret: 28 });
    expect(insertMention("a [[wi and more", 6, 2, "Wilson1974").text).toBe("a [[Wilson1974]] and more");
  });

  it("reads the papers named, once each, whatever the case of the key", () => {
    const named = mentionsIn("How do [[wilson1974]] and [[Vaswani2017-ab]] differ? [[Wilson1974]] [[nope]]", papers);
    expect(named.map((p) => p.id)).toEqual(["Wilson1974", "Vaswani2017-ab"]);
  });

  it("names them for Claude", () => {
    expect(mentionLabel(papers[0])).toBe("Vaswani et al. 2017");
    expect(mentionLabel(papers[1])).toBe("Wilson and Kogut 1974");
    expect(mentionsAsNames("Compare [[Wilson1974]].", papers)).toBe("Compare Wilson and Kogut 1974 [Wilson1974].");
  });

  it("always brings a named paper: matching passages, or else its title and abstract", () => {
    const texts = new Map([["Wilson1974", "[page 3] The epsilon expansion of critical exponents near four dimensions."]]);
    const got = mentionedPassages([papers[1], papers[0]], texts, "epsilon expansion exponents");
    expect(got[0]).toMatchObject({ paperId: "Wilson1974" });
    expect(got.at(-1)).toMatchObject({ paperId: "Vaswani2017-ab", page: 0 });
    expect(got.at(-1)!.text).toContain("Attention Is All You Need");
  });
});
