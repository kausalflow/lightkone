import { describe, expect, it } from "vitest";
import { citingOf, draftOf, fetchCitations, inLibraryOf, parseStances, rank, s2Id, stancePrompt } from "../src/core/citedby";
import type { Paper } from "../src/core/types";

const row = (over: any = {}, paper: any = {}) => ({
  contexts: ["The first direct detection of gravitational waves [1] opened a new window on the Universe."],
  intents: ["background"],
  isInfluential: false,
  citingPaper: { paperId: "a1", title: "Binary black hole populations", year: 2024, venue: "PRD", citationCount: 12, authors: [{ name: "Ada B. Lovelace" }], externalIds: { DOI: "10.1103/X", ArXiv: "2401.00001" }, ...paper },
  ...over,
});

describe("How others cite this", () => {
  it("looks a paper up by its journal DOI, else its arXiv id", () => {
    expect(s2Id({ doi: "10.1103/PhysRevLett.116.061102", arxiv: "1602.03837" })).toBe("DOI:10.1103/physrevlett.116.061102");
    expect(s2Id({ doi: "10.48550/arXiv.1706.03762" })).toBe("arXiv:1706.03762");
    expect(s2Id({ arxiv: "1706.03762v5" })).toBe("arXiv:1706.03762");
    expect(s2Id({})).toBeNull();
  });

  it("reads a citing paper and its sentences", () => {
    const c = citingOf(row({ contexts: ["short", "  (cid:2) The first direct   detection of gravitational waves [1] opened a window.", "The first direct detection of gravitational waves [1] opened a window."], intents: ["result", "odd"] }))!;
    expect(c).toMatchObject({ id: "a1", authors: ["Lovelace, Ada B."], doi: "10.1103/X", arxiv: "2401.00001", cited: 12, intents: ["result"], influential: false });
    expect(c.contexts).toEqual(["The first direct detection of gravitational waves [1] opened a window."]);
    expect(citingOf({ citingPaper: { paperId: "x" } })).toBeNull();
    expect(draftOf(c)).toMatchObject({ title: "Binary black hole populations", url: "https://arxiv.org/abs/2401.00001" });
  });

  it("puts papers with sentences first, then influential and much-cited ones", () => {
    const a = citingOf(row({ contexts: [] }, { paperId: "a", citationCount: 999 }))!;
    const b = citingOf(row({}, { paperId: "b", citationCount: 3 }))!;
    const c = citingOf(row({ isInfluential: true }, { paperId: "c", citationCount: 1 }))!;
    const d = citingOf(row({}, { paperId: "d", citationCount: 50 }))!;
    expect(rank([a, b, c, d]).map((x) => x.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("fetches the citations and the total, and says when Semantic Scholar is busy", async () => {
    const asked: string[] = [];
    const f = async (u: string) => {
      asked.push(u);
      if (!u.includes("/citations")) return Response.json({ citationCount: 1234 });
      return Response.json({ offset: 0, data: [row(), row({ contexts: [] }, { paperId: "b" })] });
    };
    const got = await fetchCitations({ doi: "10.1103/PhysRevLett.116.061102" }, { fetch: f });
    expect(got.total).toBe(1234);
    expect(got.items.map((c) => c.id)).toEqual(["a1", "b"]);
    expect(asked.some((u) => u.includes("DOI%3A10.1103%2Fphysrevlett.116.061102/citations?fields=contexts"))).toBe(true);
    await expect(fetchCitations({ arxiv: "1" }, { fetch: async () => new Response("", { status: 429 }), waits: [1] })).rejects.toThrow("busy");
    // A 429 without a CORS header reaches the page as a failed fetch; it is tried again.
    let tries = 0;
    const flaky = async (u: string) => {
      if (u.includes("/citations") && tries++ === 0) throw new TypeError("Failed to fetch");
      return f(u);
    };
    expect((await fetchCitations({ arxiv: "1706.03762" }, { fetch: flaky, waits: [1] })).items).toHaveLength(2);
    await expect(fetchCitations({}, { fetch: f })).rejects.toThrow("no DOI");
  });

  it("finds a citing paper already in the library, and reads Claude's stances", () => {
    const c = citingOf(row())!;
    const mine = { id: "m", title: "Other", doi: "10.1103/x", authors: [], tags: [], fields: {}, key: "k", type: "article", added: "" } as Paper;
    expect(inLibraryOf(c, [mine])?.id).toBe("m");
    expect(stancePrompt([c])).toContain('<citation n="1" paper="Binary black hole populations" year="2024">');
    expect(parseStances('[{"n":1,"stance":"contrasts","note":"finds a lower rate"},{"n":2,"stance":"meh"}]')).toEqual([{ n: 1, stance: "contrasts", note: "finds a lower rate" }]);
  });
});
