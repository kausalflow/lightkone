// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { epubName, ereaderFile, EreaderError, mathAsText, paperEpub, plainLetter, readSent, sendToEreader, unsend, type EreaderDeps, type Picture } from "../src/core/ereader";
import { crc32, zip } from "../src/core/zip";
import { fitSize, greyPng, mathSvg, svgSize, toGrey } from "../src/core/pictures";
import type { Paper, StorageAdapter } from "../src/core/types";

const paper = (over: Partial<Paper> = {}): Paper => ({
  id: "p1",
  key: "Gu2023",
  type: "article",
  title: "Selective state spaces",
  authors: ["Gu, Albert", "Dao, Tri"],
  year: 2023,
  arxiv: "2312.00752",
  tags: [],
  added: "2026-01-01T00:00:00Z",
  fields: {},
  ...over,
});

const mathml = (inner: string, attrs = 'display="inline"', alt = "x") =>
  `<math class="ltx_Math" alttext="${alt}" ${attrs}><semantics>${inner}<annotation encoding="application/x-tex">${alt}</annotation></semantics></math>`;

// A small paper in the shape arXiv's LaTeXML HTML has.
const LATEXML = `<!doctype html><html><head><title>t</title></head><body>
<header class="ltx_page_header">arXiv chrome</header>
<article class="ltx_document">
<h1 class="ltx_title ltx_title_document">Selective state spaces</h1>
<div class="ltx_authors">Albert Gu</div>
<div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6><p class="ltx_p">We study ${mathml("<mi>N</mi>")} models.</p></div>
<section class="ltx_section"><h2 class="ltx_title ltx_title_section">1 Introduction</h2>
<div class="ltx_para"><p class="ltx_p">A state ${mathml("<mrow><mi>h</mi><mo>(</mo><mi>t</mi><mo>)</mo></mrow>", 'display="inline"', "h(t)")} and a map ${mathml("<msup><mi>x</mi><mn>2</mn></msup>", 'display="inline"', "x^2")}.<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>A note.</span></span></span></p>
<table class="ltx_equationgroup ltx_eqn_table"><tbody>
<tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell">${mathml("<mrow><msup><mi>h</mi><mo>′</mo></msup></mrow>", 'display="inline"', "h'")}</td><td class="ltx_eqn_cell">${mathml("<mrow><mphantom></mphantom><mo>=</mo><mi>A</mi><mi>h</mi></mrow>", 'display="inline"', "=Ah")}</td><td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(1a)</span></td></tr>
</tbody></table>
<ul class="ltx_itemize"><li class="ltx_item"><span class="ltx_tag ltx_tag_item">•</span><div class="ltx_para"><p class="ltx_p">First point.</p></div></li></ul>
</div>
<figure class="ltx_figure"><object type="image/svg+xml" data="2312.00752v2/selection.svg"></object><figcaption class="ltx_caption">Figure 1: Overview.</figcaption></figure>
</section>
<section class="ltx_bibliography"><h2 class="ltx_title ltx_title_bibliography">References</h2><ul class="ltx_biblist"><li class="ltx_bibitem">A. Author. A paper. 2020.</li></ul></section>
</article></body></html>`;

const pic = (w = 40): Picture => ({ data: new Uint8Array([137, 80, 78, 71]), type: "image/png", width: w, height: 20 });

function deps(over: Partial<EreaderDeps> = {}): EreaderDeps & { maths: string[] } {
  const maths: string[] = [];
  return {
    maths,
    page: async (url) => {
      if (url.startsWith("https://arxiv.org/html/")) return { url, html: LATEXML };
      throw new Error("404");
    },
    file: async () => ({ bytes: new Uint8Array([1, 2, 3]), type: "image/svg+xml" }),
    math: async (m) => {
      maths.push(m);
      return pic();
    },
    picture: async () => pic(400),
    parse: (html) => new DOMParser().parseFromString(html, "text/html"),
    ...over,
  };
}

/** The files in a ZIP made by zip(), stored or deflated, by name. */
async function unzip(bytes: Uint8Array): Promise<Map<string, string>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  const out = new Map<string, string>();
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    const method = v.getUint16(at + 8, true);
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    let data = bytes.subarray(at + 30 + nameLen, at + 30 + nameLen + size);
    if (method === 8) data = new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    out.set(name, new TextDecoder().decode(data));
    at += 30 + nameLen + size;
  }
  return out;
}

describe("simple math stays text", () => {
  const el = (inner: string) => new DOMParser().parseFromString(`<html><body>${mathml(inner)}</body></html>`, "text/html").querySelector("math")!;

  it("keeps letters, numbers and plain operators as text", () => {
    expect(mathAsText(el("<mi>x</mi>"))).toBe("<i>x</i>");
    expect(mathAsText(el("<mrow><mi>N</mi><mo>=</mo><mn>3</mn></mrow>"))).toBe("<i>N</i> = 3");
    expect(mathAsText(el("<mrow><mi>y</mi><mo>(</mo><mi>t</mi><mo>)</mo></mrow>"))).toBe("<i>y</i>(<i>t</i>)");
    expect(mathAsText(el("<mi>𝑨</mi>"))).toBe("<b><i>A</i></b>");
    expect(mathAsText(el('<mi mathvariant="normal">sin</mi>'))).toBe("sin");
  });

  it("leaves scripts, fractions and unusual symbols to pictures", () => {
    expect(mathAsText(el("<msup><mi>x</mi><mn>2</mn></msup>"))).toBeNull();
    expect(mathAsText(el("<mfrac><mi>a</mi><mi>b</mi></mfrac>"))).toBeNull();
    expect(mathAsText(el("<mi>α</mi>"))).toBeNull();
    expect(mathAsText(el("<mi>ℝ</mi>"))).toBeNull();
    expect(mathAsText(el("<mo>∈</mo>"))).toBeNull();
  });

  it("maps mathematical letters back to plain ones", () => {
    expect(plainLetter("𝑎")).toEqual({ letter: "a", bold: false, italic: true });
    expect(plainLetter("𝐁")).toEqual({ letter: "B", bold: true, italic: false });
    expect(plainLetter("ℎ")).toEqual({ letter: "h", bold: false, italic: true });
    expect(plainLetter("𝔸")).toBeNull();
  });
});

describe("a paper as an EPUB", () => {
  it("makes a title page and one chapter per section, with equations as pictures", async () => {
    const d = deps();
    const made = await paperEpub(paper(), d);
    expect(made.source).toBe("arxiv");
    const files = await unzip(made.bytes);
    const names = [...files.keys()];
    expect(names[0]).toBe("mimetype");
    expect(files.get("mimetype")).toBe("application/epub+zip");
    expect(names).toContain("OEBPS/content.opf");
    expect(names.filter((n) => /c\d+\.xhtml$/.test(n))).toHaveLength(3);

    const title = files.get("OEBPS/c001.xhtml")!;
    expect(title).toContain("<h1>Selective state spaces</h1>");
    expect(title).toContain("Albert Gu, Tri Dao");
    expect(title).toContain("We study <i>N</i> models.");
    expect(title).not.toContain("arXiv chrome");

    const intro = files.get("OEBPS/c002.xhtml")!;
    expect(intro).toContain("<title>1 Introduction</title>");
    expect(intro).toContain("<i>h</i>(<i>t</i>)");
    expect(intro).toMatch(/<img class="m" src="images\/m\d\.png" width="40" height="20" alt="x\^2"\/>/);
    expect(intro).toContain('<span class="note"> [1: A note.]</span>');
    expect(intro).toMatch(/<p class="eq"><img class="d"[^>]*\/> <span class="tag">\(1a\)<\/span><\/p>/);
    expect(intro).toContain("<li><p>First point.</p></li>");
    expect(intro).not.toContain("•");
    expect(intro).toMatch(/<div class="fig"><img class="d" src="images\/f\d\.png" width="400"/);
    expect(intro).toContain('<p class="caption">Figure 1: Overview.</p>');
    expect(files.get("OEBPS/c003.xhtml")).toContain('<ul class="bib">');

    // An equation row is one picture, its cells joined into one run, without the TeX annotation.
    const row = d.maths.find((m) => m.includes("displaystyle"))!;
    expect(row).toMatch(/<mstyle displaystyle="true"><mrow><msup>.*<\/msup><mphantom><\/mphantom><mo>=<\/mo><mi>A<\/mi>/);
    expect(row).not.toContain("annotation");
    expect(made.mathPictures).toBe(2);
    expect(made.figures).toBe(1);

    // Every page is well-formed XML.
    for (const [name, text] of files) {
      if (!/\.(xhtml|opf|ncx)$/.test(name)) continue;
      const doc = new DOMParser().parseFromString(text, "application/xml");
      expect(doc.querySelector("parsererror"), name).toBeNull();
    }
  });

  it("falls back to ar5iv, then says plainly when there is no HTML", async () => {
    const seen: string[] = [];
    const made = await paperEpub(paper(), deps({ page: async (url) => (seen.push(url), url.includes("ar5iv") ? { url, html: LATEXML } : Promise.reject(new Error("404"))) }));
    expect(made.source).toBe("ar5iv");
    expect(seen).toEqual(["https://arxiv.org/html/2312.00752", "https://ar5iv.labs.arxiv.org/html/2312.00752"]);

    const none = deps({ page: async (url) => ({ url, html: "<html><body><p>No HTML for this paper.</p></body></html>" }) });
    await expect(paperEpub(paper(), none)).rejects.toThrow(EreaderError);
    await expect(paperEpub(paper({ arxiv: undefined }), none)).rejects.toThrow(/only arXiv papers and saved web pages/);
  });

  it("uses a saved web page for papers that aren't on arXiv", async () => {
    const made = await paperEpub(
      paper({ arxiv: undefined, html: "lightkone/pages/p1.html", url: "https://blog.example/post" }),
      deps({ saved: async () => "<html><body><article><h2>Part one</h2><p>Some <em>text</em>.</p></article></body></html>" }),
    );
    expect(made.source).toBe("page");
    const files = await unzip(made.bytes);
    expect(files.get("OEBPS/c002.xhtml")).toContain("<h2>Part one</h2><p>Some <i>text</i>.</p>");
  });

  it("writes the same equation once", async () => {
    const d = deps();
    const twice = LATEXML.replace("and a map", `and ${mathml("<msup><mi>x</mi><mn>2</mn></msup>", 'display="inline"', "x^2")} a map`);
    const made = await paperEpub(paper(), { ...d, page: async (url) => ({ url, html: twice }) });
    expect(made.mathPictures).toBe(2);
  });

  it("names the file after the first author, year and title", () => {
    expect(epubName(paper())).toBe("Gu - 2023 - Selective state spaces.epub");
  });
});

describe("the list of papers sent to the reader", () => {
  function memory(): StorageAdapter & { files: Map<string, Uint8Array | string> } {
    const files = new Map<string, Uint8Array | string>();
    return {
      files,
      read: async (p) => {
        const v = files.get(p);
        return v === undefined ? null : typeof v === "string" ? new TextEncoder().encode(v) : v;
      },
      write: async (p, d) => void files.set(p, d),
      list: async (prefix) => [...files.keys()].filter((k) => k.startsWith(prefix)),
      remove: async (p) => void files.delete(p),
    };
  }

  it("keeps the file and lists it, newest first, once per paper", async () => {
    const s = memory();
    await sendToEreader(paper(), s, deps(), "image/png", new Date("2026-11-21T10:00:00Z"));
    await sendToEreader(paper({ id: "p2", title: "Other" }), s, deps(), "image/png", new Date("2026-11-21T11:00:00Z"));
    await sendToEreader(paper(), s, deps(), "image/png", new Date("2026-11-21T12:00:00Z"));
    expect(s.files.has(ereaderFile("p1"))).toBe(true);
    const list = await readSent(s);
    expect(list.map((x) => [x.id, x.sent])).toEqual([["p1", "2026-11-21T12:00:00.000Z"], ["p2", "2026-11-21T11:00:00.000Z"]]);
    expect(list[0]).toMatchObject({ title: "Selective state spaces", authors: ["Albert Gu", "Tri Dao"], file: "lightkone/ereader/p1.epub", source: "arxiv" });

    expect((await unsend("p1", s)).map((x) => x.id)).toEqual(["p2"]);
    expect(s.files.has(ereaderFile("p1"))).toBe(false);
  });
});

describe("files and pictures", () => {
  it("checksums like everyone else", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("stores what doesn't shrink", async () => {
    const z = await zip([{ name: "mimetype", data: "application/epub+zip", store: true }]);
    expect(new DataView(z.buffer).getUint16(8, true)).toBe(0);
    expect(new TextDecoder().decode(z.subarray(30, 38))).toBe("mimetype");
  });

  it("writes grey PNGs", async () => {
    const png = await greyPng(2, 2, new Uint8Array([0, 255, 128, 64]));
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new TextDecoder().decode(png.subarray(12, 16))).toBe("IHDR");
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(0);
    expect([...toGrey(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]))]).toEqual([0, 255]);
  });

  it("draws MathML with MathJax and reads its size", async () => {
    const svg = await mathSvg('<math display="block"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>', true);
    const size = svgSize(svg)!;
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(size.width);
    expect(svg).toContain("<svg");
  });

  it("shrinks figures to the screen, never enlarges them", () => {
    expect(fitSize(1000, 500)).toEqual({ width: 440, height: 220 });
    expect(fitSize(200, 100)).toEqual({ width: 200, height: 100 });
    expect(fitSize(400, 2000)).toEqual({ width: 128, height: 640 });
  });
});

vi.setConfig({ testTimeout: 20000 });
