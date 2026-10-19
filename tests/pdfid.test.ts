import { describe, expect, it } from "vitest";
import { fallbackTitle, identifierIn } from "../src/core/pdfid";

describe("telling which paper a PDF is", () => {
  it("prefers the arXiv id printed in the margin", () => {
    expect(identifierIn(["arXiv:2106.09685v2 [cs.CL] 16 Oct 2021\nLoRA: Low-Rank Adaptation", ""])).toBe("arXiv:2106.09685v2");
    expect(identifierIn(["Preprint arXiv:hep-th/9711200v3"])).toBe("arXiv:hep-th/9711200v3");
  });
  it("finds a DOI on the first pages, without trailing punctuation", () => {
    expect(identifierIn(["Phys. Rev. Lett. 116, 061102 (2016)", "DOI: 10.1103/PhysRevLett.116.061102."])).toBe("10.1103/PhysRevLett.116.061102");
    expect(identifierIn(["https://doi.org/10.1038/s41586-021-03819-2 Received: 11 May 2021"])).toBe("10.1038/s41586-021-03819-2");
  });
  it("returns null when nothing is printed", () => {
    expect(identifierIn(["Lecture notes on the renormalization group"])).toBeNull();
  });
  it("falls back to a real title, else the file name", () => {
    expect(fallbackTitle("Lectures on the Renormalization Group", "x.pdf")).toBe("Lectures on the Renormalization Group");
    expect(fallbackTitle("Microsoft Word - draft3.docx", "wilson_kogut_1974.pdf")).toBe("wilson kogut 1974");
    expect(fallbackTitle(undefined, "notes.pdf")).toBe("notes");
  });
});
