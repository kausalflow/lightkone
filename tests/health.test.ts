import { describe, expect, it } from "vitest";
import { checkHealth, crossrefNotices, due, noticesFrom, sameNotices, worst } from "../src/core/health";
import { withdrawal } from "../functions/api/published";
import type { Paper } from "../src/core/types";

let n = 0;
const paper = (over: Partial<Paper>): Paper => ({ id: `p${n++}`, key: `k${n}`, type: "article", title: "Untitled", authors: ["Smith, A"], tags: [], added: "2026-01-01T00:00:00Z", fields: {}, ...over });
const day = (y: number, m: number, d: number) => ({ "date-parts": [[y, m, d]] });

// The shape Crossref gives a retracted paper: the notice twice, from the publisher and from Retraction Watch.
const STAP = [
  { DOI: "10.1038/nature13598", type: "retraction", label: "Retraction", source: "retraction-watch", updated: day(2014, 7, 2), "record-id": "2081" },
  { DOI: "10.1038/nature13598", type: "retraction", label: "Retraction", source: "publisher", updated: day(2014, 7, 2) },
  { DOI: "10.1038/nature13001", type: "correction", label: "Correction", source: "publisher", updated: day(2014, 3, 1) },
  { DOI: "10.1038/x", type: "new_version", label: "New version", source: "publisher" },
];

describe("paper health", () => {
  it("reads Crossref's notices, one per notice, most serious first", () => {
    expect(noticesFrom(STAP)).toEqual([
      { kind: "retracted", label: "Retraction", doi: "10.1038/nature13598", date: "2014-07-02", source: "retraction-watch, publisher" },
      { kind: "corrected", label: "Correction", doi: "10.1038/nature13001", date: "2014-03-01", source: "publisher" },
    ]);
    expect(noticesFrom(undefined)).toEqual([]);
    expect(noticesFrom([{ type: "expression_of_concern", DOI: "10.1/C" }])[0]).toMatchObject({ kind: "concern", label: "Expression of concern", doi: "10.1/c" });
  });

  it("knows a withdrawn arXiv preprint from its comment or abstract", () => {
    expect(withdrawal("<entry><summary>  This paper has been withdrawn due to an error in Eq. 4.</summary><arxiv:comment>Withdrawn</arxiv:comment></entry>")).toBe("This paper has been withdrawn due to an error in Eq. 4.");
    expect(withdrawal("<entry><summary>We study the Ising model.</summary><arxiv:comment>withdrawn</arxiv:comment></entry>")).toBe("withdrawn");
    expect(withdrawal("<entry><summary>We study withdrawn papers.</summary><arxiv:comment>12 pages; v2 withdrawn figure replaced</arxiv:comment></entry>")).toBeUndefined();
  });

  it("asks Crossref for many DOIs at once", async () => {
    const asked: string[] = [];
    const f = async (u: string) => {
      asked.push(u);
      return Response.json({ message: { items: [{ DOI: "10.1038/NATURE12968", "updated-by": STAP }, { DOI: "10.1103/physrevlett.116.061102" }] } });
    };
    const got = await crossrefNotices(["10.1038/nature12968", "10.1103/PhysRevLett.116.061102"], f);
    expect(asked).toHaveLength(1);
    expect(decodeURIComponent(asked[0])).toContain("filter=doi:10.1038/nature12968,doi:10.1103/physrevlett.116.061102");
    expect(got.get("10.1038/nature12968")?.[0].kind).toBe("retracted");
    expect(got.get("10.1103/physrevlett.116.061102")).toEqual([]);
  });

  it("checks DOIs with Crossref, preprints with arXiv, and a preprint's published version too", async () => {
    const stap = paper({ doi: "10.1038/nature12968" });
    const gone = paper({ arxiv: "0910.4008" });
    const pub = paper({ arxiv: "1234.5678", doi: "10.48550/arXiv.1234.5678" });
    const fine = paper({ doi: "10.1103/PhysRevLett.116.061102" });
    const none = paper({ title: "No identifiers" });
    const f = async (u: string) => {
      if (u.includes("api/published")) {
        return Response.json([{ arxiv: "0910.4008", withdrawn: "Withdrawn" }, { arxiv: "1234.5678", doi: "10.1000/PUB.1" }]);
      }
      return Response.json({ message: { items: [
        { DOI: "10.1038/nature12968", "updated-by": STAP },
        { DOI: "10.1000/pub.1", "updated-by": [{ DOI: "10.1000/err", type: "erratum", label: "Erratum", updated: day(2020, 1, 5) }] },
        { DOI: "10.1103/physrevlett.116.061102" },
      ] } });
    };
    const progress: number[] = [];
    const h = await checkHealth([stap, gone, pub, fine, none], { fetch: f, now: "2026-11-09T00:00:00Z", onProgress: (d) => progress.push(d) });
    expect(worst({ health: h.get(stap.id) })?.kind).toBe("retracted");
    expect(h.get(gone.id)?.notices).toEqual([{ kind: "withdrawn", label: "Withdrawn on arXiv", source: "arxiv", reason: "Withdrawn" }]);
    expect(h.get(pub.id)?.notices).toEqual([{ kind: "corrected", label: "Erratum", doi: "10.1000/err", date: "2020-01-05", source: undefined, of: "10.1000/pub.1" }]);
    expect(h.get(fine.id)).toEqual({ checked: "2026-11-09T00:00:00Z", notices: [] });
    expect(h.has(none.id)).toBe(false);
    expect(progress.at(-1)).toBe(4);
  });

  it("leaves a paper due when the service it needs failed, and fails only when nothing could be checked", async () => {
    const a = paper({ doi: "10.1/a" });
    const b = paper({ arxiv: "2401.00001" });
    const f = async (u: string) => (u.includes("api/published") ? new Response("", { status: 502 }) : Response.json({ message: { items: [{ DOI: "10.1/a" }] } }));
    const h = await checkHealth([a, b], { fetch: f });
    expect([...h.keys()]).toEqual([a.id]);
    await expect(checkHealth([b], { fetch: f })).rejects.toThrow("502");
  });

  it("says when a paper is due again", () => {
    const now = Date.parse("2026-11-09T00:00:00Z");
    expect(due(paper({ doi: "10.1/a" }), now)).toBe(true);
    expect(due(paper({ doi: "10.48550/arXiv.1" }), now)).toBe(false);
    expect(due(paper({ doi: "10.1/a", health: { checked: "2026-11-01T00:00:00Z", notices: [] } }), now)).toBe(false);
    expect(due(paper({ doi: "10.1/a", health: { checked: "2026-09-01T00:00:00Z", notices: [] } }), now)).toBe(true);
    expect(due(paper({ doi: "10.1/a", trashed: "2026-01-01" }), now)).toBe(false);
    expect(sameNotices(undefined, { checked: "x", notices: [] })).toBe(true);
  });
});
