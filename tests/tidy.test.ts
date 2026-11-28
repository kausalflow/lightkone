import { describe, expect, it } from "vitest";
import { aliasIds, choicesFor, findDuplicates, findLikelyDuplicates, findPublished, mergedMark, mergeInto, pickKeeper, scanLibrary } from "../src/core/tidy";
import { mergeLibraries } from "../src/core/merge";
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

  it("does not match papers on a DOI or arXiv id that is only spaces", () => {
    const a = paper({ title: "A first paper about gauge fields", doi: " ", arxiv: "  " });
    const b = paper({ title: "Another paper about something else", doi: "   ", arxiv: " " });
    const c = paper({ title: "A third paper on another subject", doi: "https://doi.org/" });
    const d = paper({ title: "A fourth paper that has no match", doi: "https://doi.org/" });
    expect(findDuplicates([a, b, c, d])).toEqual([]);
  });

  it("handles papers with no authors or tags (#54)", () => {
    // A hand-edited or imported library.json can leave these keys out.
    const a = paper({ title: "Impr", authors: undefined, tags: undefined });
    const b = paper({ title: "Impr", authors: [], tags: undefined });
    expect(findDuplicates([a])).toEqual([]);
    const groups = findDuplicates([a, b]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([[a.id, b.id]]);
    expect(mergeInto(a, [b]).tags).toEqual([]);
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

describe("library health", () => {
  it("skips pairs marked as not the same", () => {
    const a = paper({ title: "Attention is all you need", arxiv: "1706.03762" });
    const b = paper({ title: "Attention is all you need", arxiv: "1706.03762", distinct: [a.id] });
    expect(findDuplicates([a, b])).toEqual([]);
  });

  it("finds likely duplicates by a near title and the same first author, but not parts of a series", () => {
    const a = paper({ title: "Renormalization group flow of quantum gravity", authors: ["Reuter, M"], year: 1998 });
    const b = paper({ title: "Renormalisation group flows of quantum gravity", authors: ["Reuter, Martin"], year: 1998 });
    const other = paper({ title: "Renormalization group flow of quantum gravity", authors: ["Someone, E"], year: 1998 });
    const p1 = paper({ title: "Nonperturbative evolution equation for quantum gravity I", authors: ["Wetterich, C"], year: 2001 });
    const p2 = paper({ title: "Nonperturbative evolution equation for quantum gravity II", authors: ["Wetterich, C"], year: 2001 });
    const far = paper({ title: "Renormalization group flow of quantum gravity", authors: ["Reuter, M"], year: 2010 });
    const groups = findLikelyDuplicates([a, b, other, p1, p2, far]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([[a.id, b.id]]);
    // Already a sure duplicate (same title, the other paper): not offered again as likely.
    expect(findLikelyDuplicates([a, b], [[a, b]])).toEqual([]);
    expect(findLikelyDuplicates([a, { ...b, distinct: [a.id] }])).toEqual([]);
  });

  it("keeps every file, old keys as aliases, and the picked details", () => {
    const keep = paper({ key: "Reuter1998-rg", title: "Nonperturbative evolution equation", pdf: "papers/a.pdf", attachments: [{ path: "papers/s.pdf", name: "s.pdf", added: "2020-01-01" }] });
    const other = paper({ key: "Reuter1998-ne", title: "Non-perturbative evolution equation for quantum gravity", year: 1998, pdf: "papers/b.pdf", html: "lightkone/pages/x.html", fields: { ids: "Old1" } });
    const patch = mergeInto(keep, [other], { title: other.id });
    expect(patch.title).toBe(other.title);
    expect(patch.year).toBe(1998);
    expect(patch.pdf).toBeUndefined();
    expect(patch.html).toBe("lightkone/pages/x.html");
    expect(patch.attachments!.map((a) => a.path)).toEqual(["papers/s.pdf", "papers/b.pdf"]);
    expect(patch.fields!.ids).toBe("Old1,Reuter1998-ne");
    // Taking the other copy's key keeps the keeper's as an alias instead.
    const swapped = mergeInto(keep, [other], { key: other.id });
    expect(swapped.key).toBe("Reuter1998-ne");
    expect(swapped.fields!.ids).toBe("Old1,Reuter1998-rg");
  });

  it("offers a choice only where copies say different things", () => {
    const a = paper({ title: "Deep residual learning", authors: ["He, K", "Zhang, X"], year: 2016, doi: "10.1109/CVPR.2016.90" });
    const b = paper({ title: "Deep Residual Learning.", authors: ["He, K", "Zhang, X"], year: 2015, doi: "https://doi.org/10.1109/cvpr.2016.90", arxiv: "1512.03385" });
    const choices = choicesFor(a, [a, b]);
    expect(choices.map((c) => c.field)).toEqual(["year", "key"]);
    expect(choices[0].options).toEqual([{ value: 2016, from: [a.id] }, { value: 2015, from: [b.id] }]);
  });

  it("marks merged copies, and finds chats on them through the keeper", () => {
    const keep = paper({ title: "K" });
    const gone = paper({ title: "K", ...mergedMark(keep.id, "2026-11-28T00:00:00Z") });
    const back = paper({ title: "K", mergedInto: keep.id });
    expect(aliasIds([keep, gone, back], keep.id)).toEqual([keep.id, gone.id]);
  });

  it("keeps distinct marks from both devices in a safe save", () => {
    const base = paper({ title: "X" });
    const ours = { ...base, distinct: ["a"] };
    const theirs = { ...base, distinct: ["b"] };
    const file = (p: typeof base) => ({ format: "lightkone-library" as const, version: 1 as const, papers: [p] });
    expect(mergeLibraries(file(base), file(ours), file(theirs)).file.papers[0].distinct).toEqual(["a", "b"]);
  });

  it("scans for entries that need a look", () => {
    const now = new Date("2026-11-28T00:00:00Z");
    const ok = paper({ title: "A fine paper about something", year: 2020, doi: "10.1103/PhysRev.47.777", key: "Fine2020" });
    const bare = paper({ title: "Notes from a talk I went to", year: 2021, key: "Bare2021" });
    const gone = paper({ title: "A paper whose PDF went missing", year: 2019, pdf: "papers/gone.pdf", attachments: [{ path: "papers/here.pdf", name: "here.pdf", added: "x" }], key: "Gone2019" });
    const odd = paper({ title: "Untitled", authors: [], year: 2031, doi: "doi.org/broken", arxiv: "not-an-id", key: "Fine2020" });
    const noYear = paper({ title: "A paper without a year at all", url: "https://example.org", key: "NoYear" });
    const old = paper({ title: "Hep-th style id paper", year: 1997, arxiv: "hep-th/9711200", key: "Old1997" });
    const scan = scanLibrary([ok, bare, gone, odd, noYear, old], new Set(["papers/here.pdf"]), now);
    const kinds = (p: typeof ok) => scan.issues.filter((i) => i.paper === p).map((i) => i.kind).sort();
    expect(kinds(ok)).toEqual(["key-clash"]);
    expect(kinds(bare)).toEqual(["no-source"]);
    expect(scan.issues.find((i) => i.paper === gone)).toEqual({ kind: "missing-file", paper: gone, detail: "papers/gone.pdf" });
    expect(kinds(odd)).toEqual(["bad-arxiv", "bad-doi", "key-clash", "no-authors", "no-title", "odd-year"]);
    expect(kinds(noYear)).toEqual(["no-year"]);
    expect(kinds(old)).toEqual([]);
    expect(scan.filesChecked).toBe(true);
    // Without a listing of storage, files are not judged.
    expect(scanLibrary([gone], null, now).issues).toEqual([]);
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
