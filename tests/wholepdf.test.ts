import { describe, expect, it } from "vitest";
import { citedAnswer, wholeSet, withoutNumbers, WHOLE_MAX, type Doc } from "../src/core/wholepdf";
import type { Paper } from "../src/core/types";

const paper = (id: string, pdf = true) => ({ id, title: id, authors: [], tags: [], pdf: pdf ? `pdfs/${id}.pdf` : undefined }) as unknown as Paper;
const docs: Doc[] = [{ paperId: "a", kind: "pdf" }, { paperId: "b", kind: "pdf" }, { paperId: "c", kind: "abstract" }];
const page = (i: number, p: number, t: string) => ({ type: "page_location", document_index: i, start_page_number: p, cited_text: t });

describe("wholeSet", () => {
  it("takes chosen and named papers together, each once", () => {
    expect(wholeSet([paper("a"), paper("b")], [paper("b"), paper("c")])!.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("gives up past the limit or when a paper has no PDF", () => {
    expect(wholeSet(Array.from({ length: WHOLE_MAX + 1 }, (_, i) => paper(`p${i}`)))).toBeNull();
    expect(wholeSet([paper("a"), paper("b", false)])).toBeNull();
    expect(wholeSet([])).toBeNull();
  });
});

describe("citedAnswer", () => {
  it("numbers cited passages after the earlier sources and links them to the page", () => {
    const base = [{ n: 1, paperId: "x", page: 2, text: "old" }];
    const r = citedAnswer(
      [
        { text: "Both papers bound the mass. ", citations: [] },
        { text: "The first finds $m < 0.12$ eV.", citations: [page(0, 7, "m_nu < 0.12 eV (95%)")] },
        { text: " The second agrees", citations: [page(1, 3, "consistent with"), page(0, 7, "m_nu < 0.12  eV (95%)")] },
        { text: ", from the abstract.", citations: [{ type: "char_location", document_index: 2, cited_text: "We show" }] },
      ],
      docs,
      base,
    );
    expect(r.text).toBe("Both papers bound the mass. The first finds $m < 0.12$ eV [2]. The second agrees [3, 2], from the abstract [4].");
    expect(r.added).toEqual([
      { n: 2, paperId: "a", page: 7, text: "m_nu < 0.12 eV (95%)" },
      { n: 3, paperId: "b", page: 3, text: "consistent with" },
      { n: 4, paperId: "c", page: 0, text: "We show" },
    ]);
  });
  it("keeps the number of a passage already among the sources", () => {
    const base = [{ n: 1, paperId: "a", page: 7, text: "same words" }];
    const r = citedAnswer([{ text: "Again", citations: [page(0, 7, "same words")] }], docs, base);
    expect(r.text).toBe("Again [1]");
    expect(r.added).toEqual([]);
  });
  it("skips citations of documents it doesn't know", () => {
    expect(citedAnswer([{ text: "Hm.", citations: [page(9, 1, "x")] }], docs, []).text).toBe("Hm.");
  });
});

it("withoutNumbers gives back what Claude wrote", () => {
  expect(withoutNumbers("It holds [2]. And this [3, 4], too.")).toBe("It holds. And this, too.");
});
