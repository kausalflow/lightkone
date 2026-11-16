// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { attachment, attachmentPath, fetchFile, fetchPdf, isPdfLink, pdfLinkFor, pdfLinkIn, rememberPdfLink, sizeLabel, typeOf } from "../src/core/remotefile";
import { fileName, handle } from "../functions/api/file";
import type { Paper } from "../src/core/types";

const PDF = new TextEncoder().encode("%PDF-1.7\n...");
const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const paper = (over: Partial<Paper> = {}): Paper => ({ id: "p1", key: "Hinton2012", type: "article", title: "Improving neural networks", authors: ["Hinton, Geoffrey", "Srivastava, Nitish", "Krizhevsky, Alex"], year: 2012, tags: [], added: "2026-01-01", fields: {}, ...over });

describe("the file service", () => {
  it("names the file from Content-Disposition, else from the address", () => {
    expect(fileName("https://x.org/a/b/paper.pdf?dl=1", null)).toBe("paper.pdf");
    expect(fileName("https://x.org/download", 'attachment; filename="Supp Info.pdf"')).toBe("Supp Info.pdf");
    expect(fileName("https://x.org/download", "attachment; filename*=UTF-8''Gr%C3%BCn%20data.csv")).toBe("Grün data.csv");
    expect(fileName("https://x.org/", null)).toBe("x.org");
    expect(fileName("https://x.org/a%2F..%2Fb.pdf", null)).toBe("a .. b.pdf");
  });

  it("refuses private addresses and checks redirects", async () => {
    expect((await handle(new Request("https://lk.example/api/file?url=http://localhost/x.pdf"))).status).toBe(400);
    expect((await handle(new Request("https://lk.example/api/file?url=http://10.0.0.1/x.pdf"))).status).toBe(400);
    const redirect = (async () => new Response(null, { status: 302, headers: { location: "http://192.168.1.1/x.pdf" } })) as typeof fetch;
    expect((await handle(new Request("https://lk.example/api/file?url=https://x.org/x.pdf"), redirect)).status).toBe(400);
  });

  it("hands back the bytes as a download, with the file's own type and name in headers", async () => {
    const f = (async (u: string) =>
      u === "https://x.org/go"
        ? new Response(null, { status: 301, headers: { location: "/files/paper.pdf" } })
        : new Response(PDF as BodyInit, { headers: { "content-type": "application/pdf; charset=binary" } })) as typeof fetch;
    const r = await handle(new Request("https://lk.example/api/file?url=https://x.org/go"), f);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-file-type")).toBe("application/pdf");
    expect(r.headers.get("x-file-name")).toBe("paper.pdf");
    expect(r.headers.get("x-file-url")).toBe("https://x.org/files/paper.pdf");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PDF);
  });

  it("explains a refusal and a file that is too big", async () => {
    const no = (async () => new Response("no", { status: 403 })) as typeof fetch;
    const r = await handle(new Request("https://lk.example/api/file?url=https://x.org/a.pdf"), no);
    expect(r.status).toBe(424);
    expect((await r.json()).error).toMatch(/signed in/);
    const big = (async () => new Response("x", { headers: { "content-length": String(200 * 1024 * 1024) } })) as typeof fetch;
    expect((await handle(new Request("https://lk.example/api/file?url=https://x.org/a.pdf"), big)).status).toBe(413);
  });
});

describe("PDFs from links", () => {
  it("knows a PDF link by its address", () => {
    expect(isPdfLink("https://x.org/paper.pdf")).toBe(true);
    expect(isPdfLink("https://x.org/paper.PDF?download=1")).toBe(true);
    expect(isPdfLink("https://journals.aps.org/prl/pdf/10.1103/PhysRevLett.116.061102")).toBe(true);
    expect(isPdfLink("https://x.org/blog/post")).toBe(false);
    expect(isPdfLink("10.1103/PhysRevLett.116.061102")).toBe(false);
  });

  it("finds the PDF a page names", () => {
    expect(pdfLinkIn(doc('<meta name="citation_pdf_url" content="/doi/pdf/10.1/x">'), "https://pub.org/doi/10.1/x")).toBe("https://pub.org/doi/pdf/10.1/x");
    expect(pdfLinkIn(doc('<link rel="alternate" type="application/pdf" href="https://pub.org/x.pdf">'), "https://pub.org/x")).toBe("https://pub.org/x.pdf");
    expect(pdfLinkIn(doc('<a href="paper.pdf">PDF</a> <a href="paper.pdf">again</a>'), "https://site.org/p/")).toBe("https://site.org/p/paper.pdf");
    // Two different PDFs: which is the paper is not clear.
    expect(pdfLinkIn(doc('<a href="a.pdf">a</a><a href="b.pdf">b</a>'), "https://site.org/")).toBeNull();
    expect(pdfLinkIn(doc('<a href="javascript:x.pdf">a</a>'), "https://site.org/")).toBeNull();
  });

  it("remembers the PDF a looked-up page linked, under the paper's names", () => {
    rememberPdfLink(["https://pub.org/x", "10.1/ABC"], "https://pub.org/x.pdf");
    expect(pdfLinkFor({ doi: "10.1/abc" })).toBe("https://pub.org/x.pdf");
    expect(pdfLinkFor({ url: "https://pub.org/x" })).toBe("https://pub.org/x.pdf");
    expect(pdfLinkFor({ url: "https://other.org" })).toBeNull();
  });

  const service = (files: Record<string, { body: Uint8Array | string; type: string; name?: string }>) =>
    (async (u: string) => {
      const url = decodeURIComponent(new URL(u, "https://lk.example/app/").searchParams.get("url") ?? "");
      const f = files[url];
      if (!f) return new Response(JSON.stringify({ error: "x.org has no such file (404)." }), { status: 404 });
      return new Response(f.body as BodyInit, { headers: { "x-file-type": f.type, "x-file-name": encodeURIComponent(f.name ?? url.split("/").pop()!), "x-file-url": url } });
    }) as typeof fetch;

  it("brings a PDF, or the PDF a page names", async () => {
    const f = service({
      "https://x.org/a.pdf": { body: PDF, type: "application/octet-stream", name: "a" },
      "https://pub.org/article": { body: '<meta name="citation_pdf_url" content="/article.pdf">', type: "text/html" },
      "https://pub.org/article.pdf": { body: PDF, type: "application/pdf" },
      "https://blog.org/post": { body: "<p>no pdf here</p>", type: "text/html" },
    });
    const a = await fetchFile("https://x.org/a.pdf", f);
    expect(a).toMatchObject({ type: "application/pdf", name: "a.pdf" });
    expect((await fetchPdf("https://pub.org/article", f)).name).toBe("article.pdf");
    await expect(fetchPdf("https://blog.org/post", f)).rejects.toThrow(/no PDF/);
    await expect(fetchFile("https://x.org/missing.pdf", f)).rejects.toThrow(/no such file/);
  });
});

describe("attachments", () => {
  it("files further files next to the PDF, named after it", () => {
    const p = paper({ pdf: "papers/All Papers/HINTON/Hinton et al. 2012 - Improving neural networks.pdf" });
    expect(attachmentPath(p, "supplement.pdf", [p])).toBe("papers/All Papers/HINTON/Hinton et al. 2012 - Improving neural networks - supplement.pdf");
    const taken = { ...p, attachments: [attachment("papers/All Papers/HINTON/Hinton et al. 2012 - Improving neural networks - supplement.pdf", "supplement.pdf", PDF)] };
    expect(attachmentPath(taken, "supplement.pdf", [taken])).toBe("papers/All Papers/HINTON/Hinton et al. 2012 - Improving neural networks - supplement (2).pdf");
    // With no PDF yet, where the PDF would go.
    expect(attachmentPath(paper(), "data:set?.csv", [])).toBe("papers/All Papers/HINTON/Hinton et al. 2012 - Improving neural networks - data set .csv");
  });

  it("records what was kept", () => {
    const a = attachment("papers/x - s.zip", "s.zip", new Uint8Array(2048), "application/zip", "https://x.org/s.zip");
    expect(a).toMatchObject({ path: "papers/x - s.zip", name: "s.zip", size: 2048, type: "application/zip", from: "https://x.org/s.zip" });
    expect(sizeLabel(2048)).toBe("2 KB");
    expect(sizeLabel(3.2 * 1024 * 1024)).toBe("3.2 MB");
    expect(typeOf("slides.PPTX")).toMatch(/presentation/);
    expect(typeOf("x.bin", "application/octet-stream")).toBe("application/octet-stream");
    expect(typeOf("x.pdf", "")).toBe("application/pdf");
  });
});
