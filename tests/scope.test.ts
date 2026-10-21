import { describe, expect, it } from "vitest";
import { scoped } from "../src/core/scope";
import { inLibrary, searchLiterature, workToDraft } from "../src/core/literature";
import type { Paper } from "../src/core/types";

const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], added: "2026-01-01", fields: {}, ...p });

describe("which papers a tool works on", () => {
  const papers = [paper("a"), paper("b"), paper("c", { trashed: "2026-01-02" }), paper("d")];
  it("takes the library, the view, or picked papers, never the trash", () => {
    expect(scoped(papers, { kind: "all" }, []).map((p) => p.id)).toEqual(["a", "b", "d"]);
    expect(scoped(papers, { kind: "view" }, [papers[1], papers[2]]).map((p) => p.id)).toEqual(["b"]);
    expect(scoped(papers, { kind: "picked", ids: ["d", "c", "zz"] }, []).map((p) => p.id)).toEqual(["d"]);
    expect(scoped(papers, { kind: "literature" }, papers)).toEqual([]);
  });
});

describe("asking beyond the library", () => {
  const work = {
    id: "https://openalex.org/W1",
    title: "Neutrino masses from cosmology",
    authorships: [{ author: { display_name: "Julien Lesgourgues" } }],
    publication_year: 2006,
    doi: "https://doi.org/10.48550/arXiv.astro-ph/0603494",
    abstract_inverted_index: { Cosmology: [0], bounds: [1], masses: [2] },
    cited_by_count: 900,
  };

  it("reads OpenAlex works as drafts, arXiv preprints by their arXiv id", () => {
    const d = workToDraft(work);
    expect(d).toMatchObject({ title: "Neutrino masses from cosmology", authors: ["Lesgourgues, Julien"], year: 2006, arxiv: "astro-ph/0603494", abstract: "Cosmology bounds masses" });
    expect(d.doi).toBeUndefined();
  });

  it("searches with the question's words and keeps only papers with an abstract", async () => {
    let asked = "";
    const f = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ results: [work, { ...work, id: "W2", abstract_inverted_index: null }] }));
    }) as typeof fetch;
    const found = await searchLiterature("What bounds the neutrino mass?", { fetch: f, key: "k" });
    expect(asked).toContain("search=bounds%20neutrino%20mass");
    expect(asked).toContain("api_key=k");
    expect(found.map((w) => w.id)).toEqual(["oa:W1"]);
    expect(found[0].cited).toBe(900);
  });

  it("knows when a found paper is already in the library", () => {
    const d = workToDraft(work);
    expect(inLibrary(d, [paper("x", { arxiv: "astro-ph/0603494v2" })])?.id).toBe("x");
    expect(inLibrary(d, [paper("y", { title: "Neutrino Masses from Cosmology." })])?.id).toBe("y");
    expect(inLibrary(d, [paper("z")])).toBeUndefined();
  });
});
