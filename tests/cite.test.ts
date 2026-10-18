import { describe, expect, it } from "vitest";
import { cite, shortAuthors, unicodeMath } from "../src/core/cite";
import type { Paper } from "../src/core/types";

const paper = (p: Partial<Paper>): Paper => ({ id: "1", key: "Vaswani2017-ab", type: "article", title: "", authors: [], tags: [], added: "", fields: {}, ...p });

describe("citations", () => {
  const attention = paper({
    title: "Attention Is All You Need", authors: ["Vaswani, Ashish", "Shazeer, Noam M.", "Parmar, Niki"], year: 2017,
    venue: "Advances in Neural Information Processing Systems", arxiv: "1706.03762", fields: { volume: "30", pages: "5998--6008" },
  });

  it("makes a short post", () => {
    expect(cite(attention, "post")).toBe('"Attention Is All You Need" by Vaswani et al. (Advances in Neural Information Processing Systems 2017) https://arxiv.org/abs/1706.03762');
    expect(cite(paper({ title: "A", authors: ["Doe, J"], arxiv: "2101.00001", venue: "arXiv", year: 2021 }), "post")).toBe('"A" by Doe (arXiv 2021) https://arxiv.org/abs/2101.00001');
  });

  it("formats APA, Markdown and \\cite", () => {
    expect(cite(attention, "apa")).toBe(
      "Vaswani, A., Shazeer, N. M., & Parmar, N. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems, 30, 5998–6008. https://arxiv.org/abs/1706.03762",
    );
    expect(cite({ ...attention, doi: "10.5555/3295222" }, "markdown")).toBe("[Attention Is All You Need](https://doi.org/10.5555/3295222), Vaswani et al., 2017");
    expect(cite(attention, "latex")).toBe("\\cite{Vaswani2017-ab}");
    expect(cite(attention, "bibtex")).toContain("@article{Vaswani2017-ab,");
  });

  it("writes math as Unicode", () => {
    expect(unicodeMath("The $\\Lambda$CDM model and $H_0$ at $z\\sim 2$")).toBe("The ΛCDM model and H₀ at z∼2");
    expect(unicodeMath("$\\mathcal{N}=4$ and $x^{2}$, $e^{i\\pi}$")).toBe("N=4 and x², e^(iπ)");
  });

  it("shortens author lists", () => {
    expect(shortAuthors(["Hinton, Geoffrey"])).toBe("Hinton");
    expect(shortAuthors(["Hinton, G", "Salakhutdinov, R"])).toBe("Hinton and Salakhutdinov");
    expect(shortAuthors(["Geoffrey Hinton", "B", "C"])).toBe("Hinton et al.");
  });
});
