import { describe, expect, it } from "vitest";
import { matchPapers, scoreCommand } from "../src/CommandPalette";
import type { Paper } from "../src/core/types";

const paper = (id: string, title: string, authors: string[], extra: Partial<Paper> = {}): Paper =>
  ({ id, key: id, type: "article", title, authors, year: 2020, tags: [], added: "", ...extra }) as Paper;

describe("command palette", () => {
  it("finds a command by the start of its words, then by any part of it", () => {
    const map = { label: "Citation map", group: "Discover" };
    const eq = { label: "Search by equation", group: "Discover" };
    expect(scoreCommand(map, "cit")).toBeGreaterThan(scoreCommand(eq, "cit"));
    expect(scoreCommand(eq, "equ")).toBeGreaterThan(0);
    expect(scoreCommand(map, "map cit")).toBeGreaterThan(0);
    expect(scoreCommand(map, "xyz")).toBe(0);
  });

  it("matches its group and extra words too", () => {
    expect(scoreCommand({ label: "Add paper", group: "Actions", keywords: "arxiv doi" }, "doi")).toBeGreaterThan(0);
    expect(scoreCommand({ label: "Writing helpers", group: "Write" }, "write")).toBeGreaterThan(0);
  });

  it("finds papers by title, author and year, not in the trash", () => {
    const papers = [
      paper("a", "Attention is all you need", ["Vaswani, Ashish"], { year: 2017 }),
      paper("b", "The large N limit of superconformal field theories", ["Maldacena, Juan"]),
      paper("c", "Attention, gone", ["Nobody, A"], { trashed: "2026-01-01" } as Partial<Paper>),
    ];
    expect(matchPapers(papers, "attention").map((p) => p.id)).toEqual(["a"]);
    expect(matchPapers(papers, "maldacena large").map((p) => p.id)).toEqual(["b"]);
    expect(matchPapers(papers, "vaswani 2017").map((p) => p.id)).toEqual(["a"]);
    expect(matchPapers(papers, "a")).toEqual([]);
  });
});
