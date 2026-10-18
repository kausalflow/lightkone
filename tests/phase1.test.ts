import { describe, expect, it } from "vitest";
import type { Paper } from "../src/core/types";
import { matchPaperpilePdfs, PAPERPILE_DIR } from "../src/core/paperpile";
import { annotationsToMarkdown, mergeRects, parseAnnotations, serializeAnnotations, type Highlight } from "../src/core/annotations";
import { findOpenPdf } from "../src/core/openpdf";
import { handle } from "../functions/api/pdf";

const paper = (over: Partial<Paper>): Paper => ({
  id: "p1",
  key: "Hinton2012-im",
  type: "article",
  title: "Improving neural networks",
  authors: ["Hinton, Geoffrey", "Srivastava, Nitish"],
  year: 2012,
  tags: [],
  added: "2026-10-18T00:00:00Z",
  fields: {},
  ...over,
});

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

describe("Paperpile PDFs", () => {
  const keys = [
    `${PAPERPILE_DIR}All Papers/HINTON/Hinton et al. 2012 - Improving neural networks.pdf`,
    `${PAPERPILE_DIR}All Papers/CHEN/Chen - Probability Cheatsheet v2.0.pdf`,
    `${PAPERPILE_DIR}All Papers/SJÖSTRAND/Sjöstrand et al. 2015 - An introduction to PYTHIA 8.2.pdf`.normalize("NFD"),
    `${PAPERPILE_DIR}All Papers/A/Same.pdf`,
    `${PAPERPILE_DIR}All Papers/B/Same.pdf`,
  ];

  it("matches by path, tolerating a missing .pdf, case and Unicode form", () => {
    const papers = [
      paper({ id: "a", file: "All Papers/HINTON/Hinton et al. 2012 - Improving neural networks.pdf" }),
      paper({ id: "b", file: "All Papers/CHEN/Chen - Probability Cheatsheet v2.0" }),
      paper({ id: "c", file: "All Papers/SJÖSTRAND/Sjöstrand et al. 2015 - An introduction to PYTHIA 8.2" }),
    ];
    const m = matchPaperpilePdfs(papers, keys);
    expect(m.get("a")).toBe(keys[0]);
    expect(m.get("b")).toBe(keys[1]);
    expect(m.get("c")).toBe(keys[2]);
  });

  it("handles repeated paths, file-name fallback, ambiguity and existing PDFs", () => {
    const papers = [
      paper({ id: "rep", file: "All Papers/X/missing.pdf;All Papers/HINTON/Hinton et al. 2012 - Improving neural networks.pdf" }),
      paper({ id: "moved", file: "Other/Chen - Probability Cheatsheet v2.0.pdf" }),
      paper({ id: "amb", file: "Elsewhere/Same.pdf" }),
      paper({ id: "has", file: "All Papers/HINTON/Hinton et al. 2012 - Improving neural networks.pdf", pdf: "lightkone/pdfs/has.pdf" }),
    ];
    const m = matchPaperpilePdfs(papers, keys);
    expect(m.get("rep")).toBe(keys[0]);
    expect(m.get("moved")).toBe(keys[1]);
    expect(m.has("amb")).toBe(false);
    expect(m.has("has")).toBe(false);
  });
});

describe("annotations", () => {
  const h = (page: number, y: number, text: string, note?: string): Highlight => ({
    id: `${page}-${y}`,
    page,
    rects: [[0.1, y, 0.5, 0.02]],
    text,
    note,
    created: "2026-10-18T00:00:00Z",
  });

  it("round-trips and ignores another paper's file", () => {
    const hs = [h(2, 0.5, "b"), h(1, 0.3, "a")];
    const raw = serializeAnnotations("p1", hs);
    expect(parseAnnotations(raw, "p1").map((x) => x.text)).toEqual(["a", "b"]);
    expect(parseAnnotations(raw, "other")).toEqual([]);
    expect(parseAnnotations(null, "p1")).toEqual([]);
  });

  it("merges selection boxes on one line and keeps lines apart", () => {
    const merged = mergeRects([
      [0.1, 0.2, 0.1, 0.02],
      [0.2, 0.2005, 0.15, 0.019],
      [0.1, 0.23, 0.3, 0.02],
      [0.5, 0.5, 0, 0],
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0][0]).toBeCloseTo(0.1);
    expect(merged[0][2]).toBeCloseTo(0.25);
  });

  it("writes a Markdown note in reading order", () => {
    const md = annotationsToMarkdown(paper({ arxiv: "1207.0580" }), [h(3, 0.1, "later"), h(1, 0.9, "first", "my note")]);
    expect(md).toContain("Citation key: @Hinton2012-im");
    expect(md).toContain("https://arxiv.org/abs/1207.0580");
    expect(md.indexOf("> first")).toBeLessThan(md.indexOf("> later"));
    expect(md).toContain("> (p. 1)\n\nmy note");
  });
});

describe("open PDFs", () => {
  const fake = (routes: Record<string, () => Response>) =>
    (async (url: string | URL | Request) => {
      const u = String(url);
      const key = Object.keys(routes).find((k) => u.startsWith(k));
      return key ? routes[key]() : new Response("nope", { status: 404 });
    }) as typeof fetch;

  it("fetches arXiv directly and checks it is a PDF", async () => {
    const f = fake({ "https://arxiv.org/pdf/1207.0580": () => new Response(PDF) });
    expect(await findOpenPdf({ arxiv: "1207.0580" }, { fetch: f })).toEqual(PDF);
    const html = fake({ "https://arxiv.org/pdf/": () => new Response("<html>") });
    expect(await findOpenPdf({ arxiv: "1207.0580" }, { fetch: html })).toBeNull();
  });

  it("asks the PDF service for a DOI only with an email", async () => {
    let asked = "";
    const f = (async (url: string | URL | Request) => {
      asked = String(url);
      return new Response(PDF);
    }) as typeof fetch;
    expect(await findOpenPdf({ doi: "10.1/x" }, { fetch: f })).toBeNull();
    expect(await findOpenPdf({ doi: "10.1/x" }, { fetch: f, email: "a@b.org" })).toEqual(PDF);
    expect(asked).toBe("api/pdf?doi=10.1%2Fx&email=a%40b.org");
  });

  it("the service only fetches what Unpaywall returns, and only PDFs", async () => {
    const f = fake({
      "https://api.unpaywall.org/v2/10.1234%2Fx": () =>
        Response.json({ best_oa_location: { url_for_pdf: "https://repo.example/html" }, oa_locations: [{ url_for_pdf: "https://repo.example/paper.pdf" }] }),
      "https://repo.example/html": () => new Response("<html>"),
      "https://repo.example/paper.pdf": () => new Response(PDF),
    });
    const ok = await handle(new Request("https://site/api/pdf?doi=10.1234/x&email=a@b.org"), f);
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PDF);
    expect((await handle(new Request("https://site/api/pdf?doi=nope&email=a@b.org"), f)).status).toBe(400);
    expect((await handle(new Request("https://site/api/pdf?doi=10.1234/x"), f)).status).toBe(400);
    expect((await handle(new Request("https://site/api/pdf?doi=10.5678/none&email=a@b.org"), f)).status).toBe(404);
  });
});
