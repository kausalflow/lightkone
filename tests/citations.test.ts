import { describe, expect, it } from "vitest";
import { buildGraph, doiOf, emptyStore, fetchCitations, layout, needsFetch, worksById } from "../src/core/citations";
import type { Paper } from "../src/core/types";

const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], added: "2026-01-01", fields: {}, ...p });

function fakeOpenAlex(works: Record<string, { id: string; refs: string[]; year?: number; cited?: number }>, calls: string[] = []) {
  return (async (url: string) => {
    calls.push(String(url));
    const u = new URL(String(url));
    const filter = u.searchParams.get("filter")!;
    if (filter.startsWith("doi:")) {
      const dois = filter.slice(4).split("|");
      const results = dois.filter((d) => works[d]).map((d) => ({
        id: `https://openalex.org/${works[d].id}`,
        doi: `https://doi.org/${d.toUpperCase()}`,
        publication_year: works[d].year,
        cited_by_count: works[d].cited ?? 0,
        referenced_works: works[d].refs.map((r) => `https://openalex.org/${r}`),
      }));
      return new Response(JSON.stringify({ results }));
    }
    const ids = filter.slice("openalex:".length).split("|");
    return new Response(JSON.stringify({ results: ids.map((id) => ({ id: `https://openalex.org/${id}`, title: `Work ${id}`, doi: id === "W9" ? "https://doi.org/10.48550/arxiv.1706.03762" : null, publication_year: 1999, authorships: [{ author: { display_name: "Kenneth G. Wilson" } }], cited_by_count: 42 })) }));
  }) as typeof fetch;
}

describe("citation map", () => {
  it("looks papers up by DOI, arXiv's DOI for preprints, once", async () => {
    expect(doiOf(paper("a", { doi: "https://doi.org/10.1/ABC" }))).toBe("10.1/abc");
    expect(doiOf(paper("b", { arxiv: "arXiv:1706.03762v2" }))).toBe("10.48550/arxiv.1706.03762");
    const papers = [paper("a", { doi: "10.1/a" }), paper("b", { arxiv: "2001.00001" }), paper("c", { doi: "10.1/unknown" }), paper("d")];
    const s = emptyStore();
    const calls: string[] = [];
    const f = fakeOpenAlex({ "10.1/a": { id: "W1", refs: ["W2", "W7"] }, "10.48550/arxiv.2001.00001": { id: "W2", refs: ["W7"] } }, calls);
    expect(await fetchCitations(papers, s, { fetch: f, key: "k" })).toBe(2);
    expect(calls[0]).toContain("api_key=k");
    expect(s.works.a).toMatchObject({ oa: "W1", refs: ["W2", "W7"] });
    expect(s.works.c.oa).toBeNull();
    expect(needsFetch(papers, s)).toEqual([]);
    expect(needsFetch(papers, s, Date.now() + 40 * 24 * 3600 * 1000).map((p) => p.id)).toEqual(["c"]);
  });

  it("links papers that cite each other and lists works cited by several", () => {
    const papers = [paper("a", { year: 2020 }), paper("b", { year: 2015 }), paper("c", { year: 2021 }), paper("t", { trashed: "x" })];
    const s = emptyStore();
    const at = "2026-01-01T00:00:00Z";
    s.works = {
      a: { oa: "W1", refs: ["W2", "W7", "W8"], at, cited: 10 },
      b: { oa: "W2", refs: ["W7"], at },
      c: { oa: "W3", refs: ["W1", "W2", "W7", "W8", "W9"], at },
      t: { oa: "W4", refs: ["W9"], at },
    };
    const g = buildGraph(papers, s);
    expect(g.edges).toEqual([["a", "b"], ["c", "a"], ["c", "b"]]);
    expect(g.nodes.get("b")!.citedBy).toEqual(["a", "c"]);
    expect(g.missing).toEqual([{ oa: "W7", by: ["a", "b", "c"] }, { oa: "W8", by: ["a", "c"] }]);
    expect(g.known).toBe(3);

    const placed = layout(g, ["a", "b", "c"], () => 0, 1, { width: 1000, bandHeight: 100, years: [2014, 2022] });
    expect(placed).toHaveLength(3);
    for (const p of placed) expect(p.y).toBeGreaterThan(0);
    const [pa, pb] = ["a", "b"].map((id) => placed.find((p) => p.id === id)!);
    expect(pb.x).toBeLessThan(pa.x);
    for (const p of placed) for (const q of placed) if (p !== q) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(p.r + q.r);
  });

  it("reads works to add, with arXiv preprints as arXiv ids", async () => {
    const m = await worksById(["W8", "W9"], { fetch: fakeOpenAlex({}) });
    expect(m.get("W8")).toMatchObject({ title: "Work W8", authors: ["Wilson, Kenneth G."], year: 1999, cited: 42 });
    expect(m.get("W9")).toMatchObject({ arxiv: "1706.03762", doi: undefined });
  });
});
