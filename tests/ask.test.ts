import { describe, expect, it } from "vitest";
import { chunks, linkCitations, retrieve, sourceLabel, sourcesPrompt, terms } from "../src/core/ask";
import { joinPages } from "../src/core/fulltext";
import type { Paper } from "../src/core/types";

const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], added: "2026-01-01", fields: {}, ...p });

describe("ask your library", () => {
  it("keeps the words worth looking for", () => {
    expect(terms("How does the renormalization group flow in the Ising model?")).toEqual(["renormalization", "group", "flow", "ising", "model"]);
  });

  it("cuts pages into passages and remembers the page", () => {
    const filler = "word ".repeat(400);
    const cs = chunks(joinPages(["Short first page about nothing much at all, really.", `${filler}end`]), 1000);
    expect(cs[0].page).toBe(1);
    expect(cs.slice(1).every((c) => c.page === 2)).toBe(true);
    expect(cs.every((c) => c.text.length <= 1000)).toBe(true);
  });

  it("finds the pages that answer, and abstracts of papers without text", () => {
    const papers = [
      paper("a", { title: "Critical phenomena", authors: ["Wilson, Kenneth"], year: 1971 }),
      paper("b", { title: "Protein structure", abstract: "We predict protein structures with deep learning." }),
      paper("c", { title: "Old one", trashed: "2026-01-01", abstract: "renormalization group everywhere" }),
      paper("d", { title: "A review of the renormalization group", abstract: "The renormalization group explains universality." }),
    ];
    const texts = new Map([["a", joinPages(["Introduction to scaling.", "The renormalization group flow has a fixed point at the critical temperature."])]]);
    const found = retrieve(papers, texts, "What does the renormalization group flow do?");
    expect(found.map((s) => s.paperId)).not.toContain("c");
    expect(found.map((s) => s.paperId)).not.toContain("b");
    expect(found.find((s) => s.paperId === "a" && s.page === 2)).toBeTruthy();
    expect(found.find((s) => s.paperId === "d" && s.page === 0)).toBeTruthy();
    expect(found.map((s) => s.n)).toEqual(found.map((_, i) => i + 1));
    const byId = new Map(papers.map((p) => [p.id, p]));
    const a = found.find((s) => s.paperId === "a" && s.page === 2)!;
    expect(sourceLabel(a, byId.get("a"))).toBe("Wilson 1971, p. 2");
    expect(sourcesPrompt([a], byId)).toContain(`<source n="${a.n}" paper="Critical phenomena (1971)" authors="Wilson, Kenneth" page="2">`);
  });

  it("links citations in the answer but not inside math or code", () => {
    const label = (n: number) => (n <= 2 ? `Source ${n}` : null);
    const html = linkCitations(
      '<p>Flows to a fixed point [1, 2]. Not this [7]. <span class="katex"><span>x_[1]</span></span> <code>a[1]</code> and [2].</p>',
      label,
    );
    expect(html).toContain('<span class="srcs"><a href="#" class="src" data-src="1">Source 1</a>; <a href="#" class="src" data-src="2">Source 2</a></span>');
    expect(html).toContain("Not this [7]");
    expect(html).toContain("<span>x_[1]</span>");
    expect(html).toContain("<code>a[1]</code>");
    expect(html).toContain('and <span class="srcs"><a href="#" class="src" data-src="2">Source 2</a></span>.');
  });
});
