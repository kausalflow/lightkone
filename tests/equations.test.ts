import { describe, expect, it } from "vitest";
import { extractEquations, emptyEquations, indexEquations, overToFrac, prepareEquations, searchEquations, skeleton, tokens, toIndex, type EquationStore } from "../src/core/equations";
import { handle, sourceOf, untar } from "../functions/api/tex";
import type { Paper } from "../src/core/types";

const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], added: "2026-01-01", fields: {}, ...p });

async function gzipSync(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function tar(files: Record<string, string>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = new TextEncoder().encode(text);
    const h = new Uint8Array(512);
    h.set(new TextEncoder().encode(name), 0);
    h.set(new TextEncoder().encode(body.length.toString(8).padStart(11, "0")), 124);
    h[156] = "0".charCodeAt(0);
    h.set(new TextEncoder().encode("ustar"), 257);
    parts.push(h, body, new Uint8Array((512 - (body.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
}

const TEX = String.raw`\documentclass{article}
\newcommand{\R}{\mathbb{R}}
\begin{document}
Inline $x$ is skipped. % \begin{equation} commented \end{equation}
\begin{equation}\label{eq:att}
  \mathrm{Attention}(Q,K,V) = \mathrm{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right) V
\end{equation}
\begin{align}
  a &= b + c \\
  f &: \R \to \R \nonumber
\end{align}
\[ E = mc^2 \]
\end{document}`;

describe("equations from LaTeX source", () => {
  it("takes displayed equations, a row of an align each, with simple macros expanded", () => {
    expect(extractEquations(TEX)).toEqual([
      String.raw`\mathrm{Attention}(Q,K,V) = \mathrm{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right) V`,
      "a = b + c",
      String.raw`f : \mathbb{R} \to \mathbb{R}`,
      "E = mc^2",
    ]);
  });

  it("reads plain TeX with harvmac, where \\[ may be a bracket", () => {
    const plain = String.raw`\input harvmac
\def\[{\left [}
\eqn\metric{\eqalign{ ds^2 &= f^{-1/2} dx^2 \cr f &= 1 + {R^4 \over r^4} }}
and $\[ x \]$ in text.`;
    expect(extractEquations(plain)).toEqual(["ds^2 = f^{-1/2} dx^2", String.raw`f = 1 + {R^4 \over r^4}`]);
    expect(overToFrac(String.raw`1 + {R^4 \over \sqrt{r^4}}`)).toBe(String.raw`1 + \frac{R^4}{\sqrt{r^4}}`);
  });

  it("unpacks arXiv's e-prints: a gzipped tar, a gzipped .tex, or a PDF", async () => {
    const archive = tar({ "main.tex": "\\begin{equation}x=1\\end{equation}", "fig.png": "PNG", "sec/b.tex": "\\[y=2\\]" });
    expect([...untar(archive).keys()]).toEqual(["main.tex", "fig.png", "sec/b.tex"]);
    expect(extractEquations(await sourceOf(await gzipSync(archive)))).toEqual(["x=1", "y=2"]);
    expect(await sourceOf(await gzipSync(TEX))).toBe(TEX);
    expect(await sourceOf(new TextEncoder().encode("%PDF-1.5 ..."))).toBe("");

    const asked: string[] = [];
    const f = (async (url: string) => (asked.push(String(url)), new Response((await gzipSync(TEX)) as Uint8Array<ArrayBuffer>))) as typeof fetch;
    const r = await handle(new Request("https://x/api/tex?arxiv=1706.03762v7"), f);
    expect(asked).toEqual(["https://arxiv.org/e-print/1706.03762v7"]);
    expect(r.headers.get("cache-control")).toBe("public, max-age=604800");
    expect((await r.json()).equations).toHaveLength(4);
    expect((await handle(new Request("https://x/api/tex?arxiv=../etc"), f)).status).toBe(400);
  });
});

describe("search by equation", () => {
  it("reads LaTeX past spacing, sizing, braces and \\over", () => {
    expect(tokens(String.raw`\left( \frac{a}{b} \right)^{2} \, ~ \dfrac{1}{x}`)).toEqual(tokens(String.raw`({a \over b})^2 \frac{1}{x}`));
    expect(skeleton(tokens("E = mc^2"))).toEqual(skeleton(tokens("F = ma^2")));
  });

  const store = {
    ...emptyEquations(),
    papers: {
      att: { arxiv: "1706.03762", at: "", equations: extractEquations(TEX) },
      other: { arxiv: "2001.00001", at: "", equations: ["x^2 + y^2 = z^2", String.raw`\mathrm{softmax}(\frac{AB^T}{\sqrt{d_n}})C`] },
    },
  };

  it("finds an equation however it is written, then the same form with other letters", () => {
    const hits = searchEquations(store, String.raw`\text{softmax}\Big(\dfrac{Q K^{T}}{\sqrt{d_k}}\Big)\,V`);
    expect(hits[0]).toMatchObject({ paperId: "att", renamed: false });
    expect(hits[0].score).toBeGreaterThan(0.85);
    expect(hits[1]).toMatchObject({ paperId: "other", renamed: true });
    expect(searchEquations(store, "E = m c^{2}")[0]).toMatchObject({ paperId: "att", equation: "E = mc^2" });
    expect(searchEquations(store, String.raw`\nabla \cdot B = 0`)).toEqual([]);
  });

  it("reads each arXiv paper once, saving as it goes", async () => {
    const papers = [paper("a", { arxiv: "arXiv:1706.03762v7" }), paper("b"), paper("c", { arxiv: "2001.00001" })];
    const s = emptyEquations();
    const asked: string[] = [];
    let saved = 0;
    const f = (async (url: string) => (asked.push(String(url)), new Response(JSON.stringify({ equations: ["x=1"] })))) as typeof fetch;
    expect(await indexEquations(papers, s, { fetch: f, onBatch: async () => void saved++ })).toBe(2);
    expect(asked).toEqual(["api/tex?arxiv=1706.03762", "api/tex?arxiv=2001.00001"]);
    expect(s.papers.a.equations).toEqual(["x=1"]);
    expect(saved).toBe(1);
    expect(toIndex(papers, s)).toEqual([]);
  });

  it("keeps its index between searches, adding only papers read since", async () => {
    const s: EquationStore = { ...emptyEquations(), papers: { a: { arxiv: "1", at: "t1", equations: ["E = mc^2"] } } };
    const progress: number[] = [];
    await prepareEquations(s, (d) => progress.push(d));
    expect(progress).toEqual([1]);
    expect(searchEquations(s, "x^2 + y^2 = z^2")).toEqual([]);
    s.papers.b = { arxiv: "2", at: "t2", equations: ["x^2 + y^2 = z^2"] };
    expect(searchEquations(s, "x^2 + y^2 = z^2").map((h) => h.paperId)).toEqual(["b"]);
    progress.length = 0;
    await prepareEquations(s, (d) => progress.push(d));
    expect(progress).toEqual([]);
    // A paper read again: its old equations go.
    s.papers.a = { arxiv: "1", at: "t3", equations: ["F = ma"] };
    expect(searchEquations(s, "E = mc^2")).toEqual([]);
    expect(searchEquations(s, "F = ma").map((h) => h.paperId)).toEqual(["a"]);
  });
});
