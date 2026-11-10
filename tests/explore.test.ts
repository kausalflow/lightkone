import { describe, expect, it } from "vitest";
import { emptyStore } from "../src/core/citations";
import { EXPLORE_PATH, explore, loadResult, resultPath, saveResult, filterCandidates, loadExplorations, nameFor, reasons, saveExplorations, scatter } from "../src/core/explore";
import type { StorageAdapter } from "../src/core/types";

// A tiny citation network:
//   S1, S2 are the roots. S1 cites R1, R2; S2 cites R1, R3.
//   C1 cites S1 and S2 (and R1, R2); C2 cites S1 only; C3 cites S2 and shares R1, R3.
//   L1 is a library paper that cites C2.
const W: Record<string, { year: number; cited: number; refs: string[] }> = {
  S1: { year: 2015, cited: 900, refs: ["R1", "R2"] },
  S2: { year: 2017, cited: 400, refs: ["R1", "R3"] },
  R1: { year: 2010, cited: 5000, refs: [] },
  R2: { year: 2012, cited: 50, refs: [] },
  R3: { year: 2011, cited: 20, refs: [] },
  C1: { year: 2020, cited: 30, refs: ["S1", "S2", "R1", "R2"] },
  C2: { year: 2019, cited: 300, refs: ["S1"] },
  C3: { year: 2021, cited: 3, refs: ["S2", "R1", "R3"] },
};
const row = (id: string) => ({
  id: `https://openalex.org/${id}`,
  title: `Work ${id}`,
  doi: id === "C2" ? "https://doi.org/10.48550/arxiv.1901.00001" : `https://doi.org/10.1/${id.toLowerCase()}`,
  publication_year: W[id].year,
  cited_by_count: W[id].cited,
  authorships: [{ author: { display_name: "Ada Lovelace" } }],
  referenced_works: W[id].refs.map((r) => `https://openalex.org/${r}`),
});

function fake(calls: string[] = []) {
  return (async (url: string) => {
    calls.push(String(url));
    const filter = new URL(String(url)).searchParams.get("filter")!;
    if (filter.startsWith("openalex:")) return new Response(JSON.stringify({ results: filter.slice(9).split("|").filter((id) => W[id]).map(row) }));
    if (filter.startsWith("cites:")) {
      const roots = filter.slice(6).split("|");
      const ids = Object.keys(W).filter((id) => W[id].refs.some((r) => roots.includes(r))).sort((a, b) => W[b].cited - W[a].cited);
      return new Response(JSON.stringify({ results: ids.map(row) }));
    }
    return new Response("{}", { status: 400 });
  }) as typeof fetch;
}

function memory(): StorageAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(path: string) {
      const v = files.get(path);
      return v === undefined ? null : new TextEncoder().encode(v);
    },
    async write(path: string, data: string | Uint8Array) {
      files.set(path, typeof data === "string" ? data : new TextDecoder().decode(data));
    },
  } as any;
}

describe("explore", () => {
  it("walks out from roots and ranks by ties, not just citations", async () => {
    const store = emptyStore();
    store.works.lib1 = { oa: "L1", refs: ["C2"], at: "2026-01-01T00:00:00Z" };
    store.works.s1 = { oa: "S1", refs: ["R1", "R2"], at: "2026-01-01T00:00:00Z" };
    const calls: string[] = [];
    const r = await explore([{ oa: "S1", title: "S1", paperId: "s1" }, { oa: "S2", title: "S2" }], store, { fetch: fake(calls), key: "k" });
    expect(calls.every((c) => c.includes("api_key=k"))).toBe(true);
    expect(r.roots.map((s) => [s.oa, s.year])).toEqual([["S1", 2015], ["S2", 2017]]);
    const ids = r.candidates.map((c) => c.oa);
    expect(ids).not.toContain("S1");
    // C1 cites both roots; R1 is cited by both. Both outrank the more cited C2.
    expect(ids.slice(0, 2).sort()).toEqual(["C1", "R1"]);
    const c1 = r.candidates.find((c) => c.oa === "C1")!;
    expect(c1.citesRoots).toEqual(["S1", "S2"]);
    expect(c1.shared).toBe(2);
    const r1 = r.candidates.find((c) => c.oa === "R1")!;
    expect(r1.citedByRoots).toEqual(["S1", "S2"]);
    // C2 is cited by a library paper.
    expect(r.candidates.find((c) => c.oa === "C2")!.libraryLinks).toEqual(["lib1"]);
    expect(reasons(c1, 2)).toEqual(["cites 2 of the 2 roots", "shares 2 references"]);
    expect(reasons(r.candidates.find((c) => c.oa === "C2")!, 2)).toEqual(["cites 1 of the 2 roots", "linked to 1 of your papers"]);
    expect(r.candidates.find((c) => c.oa === "C2")!.draft.arxiv).toBe("1901.00001");
  });

  it("marks library papers and filters", async () => {
    const store = emptyStore();
    store.works.c3 = { oa: "C3", refs: W.C3.refs, at: "2026-01-01T00:00:00Z" };
    const r = await explore([{ oa: "S2", title: "S2" }], store, { fetch: fake() });
    expect(r.candidates.find((c) => c.oa === "C3")!.paperId).toBe("c3");
    expect(filterCandidates(r.candidates, { hideLibrary: true }, new Set()).map((c) => c.oa)).not.toContain("C3");
    expect(filterCandidates(r.candidates, { from: 2018 }, new Set()).every((c) => c.year >= 2018)).toBe(true);
    expect(filterCandidates(r.candidates, { onlyNew: true }, new Set(["R3"])).map((c) => c.oa)).toEqual(["R3"]);
    expect(filterCandidates(r.candidates, { sort: "cited" }, new Set())[0].oa).toBe("R1");
    expect(filterCandidates(r.candidates, { sort: "newest" }, new Set())[0].oa).toBe("C3");
    expect(filterCandidates(r.candidates, { text: "work c1" }, new Set()).map((c) => c.oa)).toEqual(["C1"]);
  });

  it("grows the whole library: only works tied to two or more of your papers, from stored references", async () => {
    const store = emptyStore();
    const at = "2026-01-01T00:00:00Z";
    store.works.s1 = { oa: "S1", year: 2015, cited: 900, refs: ["R1", "R2"], at };
    store.works.s2 = { oa: "S2", year: 2017, cited: 400, refs: ["R1", "R3"], at };
    const calls: string[] = [];
    const r = await explore([{ oa: "S1", title: "S1", paperId: "s1" }, { oa: "S2", title: "S2", paperId: "s2" }], store, { fetch: fake(calls) }, { library: true });
    // The roots' references come from the store: no lookup of the roots themselves.
    expect(calls.some((c) => /openalex%3AS1|openalex:S1/.test(c))).toBe(false);
    expect(r.library).toBe(true);
    // C1 cites both, R1 is cited by both; C2, C3, R2, R3 tie to one paper only.
    expect(r.candidates.map((c) => c.oa).sort()).toEqual(["C1", "R1"]);
    expect(reasons(r.candidates.find((c) => c.oa === "C1")!, 2, true)[0]).toBe("cites 2 of your papers");
  });

  it("keeps explorations in their own file", async () => {
    const s = memory();
    expect((await loadExplorations(s)).items).toEqual([]);
    const ex = { id: "x1", name: nameFor([{ oa: "S1", title: "Attention" }, { oa: "S2", title: "B" }]), roots: [{ oa: "S1", title: "Attention" }], seen: ["C1"], made: "2026-11-10T00:00:00Z" };
    expect(ex.name).toBe("Attention + 1");
    await saveExplorations(s, { format: "lightkone-branches", version: 1, items: [ex] });
    expect(s.files.has(EXPLORE_PATH)).toBe(true);
    expect((await loadExplorations(s)).items[0].seen).toEqual(["C1"]);
    s.files.set(EXPLORE_PATH, "not json");
    expect((await loadExplorations(s)).items).toEqual([]);
  });

  it("keeps a branch's last result in storage, leaving library roots' references to citations.json", async () => {
    const store = emptyStore();
    const at = "2026-01-01T00:00:00Z";
    store.works.s1 = { oa: "S1", year: 2015, cited: 900, refs: ["R1", "R2"], at };
    store.works.s2 = { oa: "S2", year: 2017, cited: 400, refs: ["R1", "R3"], at };
    const roots = [{ oa: "S1", title: "S1", paperId: "s1" }, { oa: "S2", title: "S2", paperId: "s2" }];
    const r = await explore(roots, store, { fetch: fake() }, { library: true });
    const s = memory();
    expect(resultPath("library", roots)).toBe("lightkone/branches/library.json");
    expect(resultPath("folder:Deep learning", roots)).toMatch(/^lightkone\/branches\/folder-deep-learning-\w+\.json$/);
    expect(resultPath("pick", roots)).toBe(resultPath("pick", [...roots].reverse()));
    await saveResult(s, resultPath("library", roots), "library", r);
    const raw = JSON.parse(s.files.get("lightkone/branches/library.json")!);
    expect(raw.roots[0].refs).toBeUndefined();
    const back = (await loadResult(s, resultPath("library", roots), store))!;
    expect(back.candidates.map((c) => c.oa)).toEqual(r.candidates.map((c) => c.oa));
    expect(back.roots[0].refs).toEqual(["R1", "R2"]);
    expect(back.at).toBe(r.at);
    expect(await loadResult(s, "lightkone/branches/none.json", store)).toBeNull();
  });

  it("places dots by year and citations without overlap", () => {
    const dots = [
      { id: "a", year: 2020, cited: 100, r: 6 },
      { id: "b", year: 2020, cited: 100, r: 6 },
      { id: "c", year: 2010, cited: 0, r: 4 },
    ];
    const { spots, yOf } = scatter(dots, { width: 1000, height: 400, years: [2009, 2021] });
    const [a, b, c] = ["a", "b", "c"].map((id) => spots.find((s) => s.id === id)!);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(12);
    expect(c.x).toBeLessThan(a.x);
    expect(yOf(1000)).toBeLessThan(yOf(10));
  });
});
