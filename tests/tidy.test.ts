import { describe, expect, it } from "vitest";
import { findDuplicates, findPublished, mergeInto, pickKeeper } from "../src/core/tidy";
import type { Paper } from "../src/core/types";
import { handle } from "../functions/api/published";

let n = 0;
const paper = (over: Partial<Paper>): Paper => ({ id: `p${n++}`, key: `k${n}`, type: "article", title: "Untitled", authors: ["Smith, A"], tags: [], added: `2026-01-0${(n % 9) + 1}T00:00:00Z`, fields: {}, ...over });

describe("duplicates", () => {
  it("groups by DOI, arXiv id and title, chaining matches, ignoring the trash", () => {
    const a = paper({ title: "Attention is all you need", arxiv: "1706.03762" });
    const b = paper({ title: "Attention Is All You Need.", doi: "10.5555/3295222" });
    const c = paper({ title: "Something else entirely", doi: "10.5555/3295222" });
    const d = paper({ title: "Unrelated paper about renormalization", arxiv: "1706.03762v2", trashed: "2026-02-01T00:00:00Z" });
    const short1 = paper({ title: "Dropout", authors: ["Hinton, G"] });
    const short2 = paper({ title: "Dropout", authors: ["Srivastava, N"] });
    const groups = findDuplicates([a, b, c, d, short1, short2]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([[a.id, b.id, c.id]]);
  });

  it("keeps the copy with a PDF and gathers everything else into it", () => {
    const old = paper({ title: "T", added: "2020-01-01T00:00:00Z", tags: ["rg"], folders: ["Physics"], notes: "first", abstract: "abs" });
    const withPdf = paper({ title: "T", added: "2024-01-01T00:00:00Z", pdf: "papers/x.pdf", tags: ["ml"], notes: "second", starred: true, fields: { pages: "1-2" } });
    const keep = pickKeeper([old, withPdf]);
    expect(keep).toBe(withPdf);
    const patch = mergeInto(keep, [old]);
    expect(patch).toMatchObject({ tags: ["ml", "rg"], folders: ["Physics"], notes: "second\n\nfirst", starred: true, abstract: "abs", added: "2020-01-01T00:00:00Z" });
    expect(patch.pdf).toBeUndefined();
  });
});

describe("published versions", () => {
  it("asks the service in one batch and takes the record from Crossref", async () => {
    const pre = paper({ title: "A", arxiv: "1512.03385" });
    const unpublished = paper({ title: "B", arxiv: "2401.00001", doi: "10.48550/arXiv.2401.00001" });
    const done = paper({ title: "C", arxiv: "1207.0580", doi: "10.1000/already" });
    const asked: string[] = [];
    const get = async (url: string) => {
      asked.push(url);
      return [{ arxiv: "1512.03385", doi: "10.1109/CVPR.2016.90" }, { arxiv: "2401.00001" }];
    };
    const crossref = async (doi: string) => ({ title: "A", doi, venue: "CVPR", year: 2016, type: "inproceedings", fields: { pages: "770-778" } });
    const progress: number[] = [];
    const found = await findPublished([pre, unpublished, done], crossref, (d) => progress.push(d), get);
    expect(asked).toEqual(["api/published?arxiv=1512.03385,2401.00001"]);
    expect(found).toHaveLength(1);
    expect(found[0].paper).toBe(pre);
    expect(found[0].patch).toEqual({ doi: "10.1109/CVPR.2016.90", venue: "CVPR", year: 2016, type: "inproceedings", fields: { pages: "770-778" } });
    expect(progress).toEqual([1, 2]);
  });

  it("the service reads arXiv's DOI and journal reference, then Semantic Scholar", async () => {
    const atom = `<feed><entry><id>http://arxiv.org/abs/cond-mat/0106096v1</id><arxiv:journal_ref xmlns:arxiv="x">Reviews of Modern
      Physics 74, 47 (2002)</arxiv:journal_ref><arxiv:doi xmlns:arxiv="x">10.1103/RevModPhys.74.47</arxiv:doi></entry>
      <entry><id>http://arxiv.org/abs/1512.03385v1</id></entry></feed>`;
    let s2Body = "";
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("https://export.arxiv.org/")) return new Response(atom);
      s2Body = String(init?.body);
      return Response.json([{ externalIds: { DOI: "10.1109/CVPR.2016.90" }, venue: "CVPR" }]);
    }) as typeof fetch;
    const r = await handle(new Request("https://site/api/published?arxiv=cond-mat/0106096,1512.03385v2"), f);
    expect(await r.json()).toEqual([
      { arxiv: "cond-mat/0106096", doi: "10.1103/RevModPhys.74.47", venue: "Reviews of Modern Physics 74, 47 (2002)" },
      { arxiv: "1512.03385", doi: "10.1109/CVPR.2016.90", venue: "CVPR" },
    ]);
    expect(JSON.parse(s2Body).ids).toEqual(["arXiv:1512.03385"]);
    expect((await handle(new Request("https://site/api/published?arxiv=nope"), f)).status).toBe(400);
  });
});
