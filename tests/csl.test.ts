import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findStyles, formatBibliography, localeOf, parentOf, toCslItem } from "../src/core/csl";
import type { Paper } from "../src/core/types";

// The APS style and the US English locale, from the CSL project (CC BY-SA 3.0).
const aps = readFileSync(new URL("./fixtures/american-physics-society.csl", import.meta.url), "utf8");
const enUS = readFileSync(new URL("./fixtures/locales-en-US.xml", import.meta.url), "utf8");

const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], added: "2026-01-01", fields: {}, ...p });

describe("citation styles", () => {
  it("turns a paper into a CSL item", () => {
    expect(toCslItem(paper("Wilson1971", { title: "Renormalization group and critical phenomena. {I}", authors: ["Wilson, Kenneth G."], year: 1971, venue: "Phys. Rev. B", doi: "10.1103/PhysRevB.4.3174", fields: { volume: "4", pages: "3174--3183" } }))).toEqual({
      id: "Wilson1971",
      type: "article-journal",
      title: "Renormalization group and critical phenomena. I",
      author: [{ family: "Wilson", given: "Kenneth G." }],
      issued: { "date-parts": [[1971]] },
      "container-title": "Phys. Rev. B",
      volume: "4",
      page: "3174–3183",
      DOI: "10.1103/PhysRevB.4.3174",
    });
    expect(toCslItem(paper("p", { arxiv: "2101.00001", authors: ["Ada Lovelace"] }))).toMatchObject({ type: "article", "container-title": "arXiv", author: [{ family: "Lovelace", given: "Ada" }] });
  });

  it("follows a journal's style to the one it borrows, and reads its language", async () => {
    expect(parentOf('<link href="http://www.zotero.org/styles/american-physics-society" rel="independent-parent"/>')).toBe("american-physics-society");
    expect(localeOf('<style default-locale="de-DE">')).toBe("de-DE");
    expect(localeOf("<style>")).toBe("en-US");
    const asked: string[] = [];
    const f = (async (url: string) => {
      asked.push(url);
      if (url.endsWith("/master/physical-review-d.csl")) return new Response("", { status: 404 });
      if (url.endsWith("/dependent/physical-review-d.csl")) return new Response('<style><link href="http://www.zotero.org/styles/american-physics-society" rel="independent-parent"/></style>');
      if (url.endsWith("/american-physics-society.csl")) return new Response(aps);
      return new Response(enUS);
    }) as typeof fetch;
    const out = await formatBibliography([paper("Wilson1971", { title: "Renormalization group and critical phenomena", authors: ["Wilson, Kenneth G."], year: 1971, venue: "Phys. Rev. B", fields: { volume: "4", pages: "3174" } })], "physical-review-d", "text", f);
    expect(asked.some((u) => u.includes("dependent/physical-review-d"))).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("K. G. Wilson");
    expect(out[0]).toContain("Phys. Rev. B");
    expect(out[0]).toContain("3174");
    expect(out[0]).toContain("1971");
  });

  it("finds styles by the words of their title", () => {
    const all = [{ id: "physical-review-d", title: "Physical Review D" }, { id: "physical-review-letters", title: "Physical Review Letters" }, { id: "nature", title: "Nature" }];
    expect(findStyles(all, "review d").map((s) => s.id)).toEqual(["physical-review-d"]);
    expect(findStyles(all, "physical").map((s) => s.id)).toEqual(["physical-review-d", "physical-review-letters"]);
    expect(findStyles(all, " ")).toEqual([]);
  });
});
