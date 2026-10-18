import { describe, expect, it } from "vitest";
import { arxivId, doiOf, invertedToText, yearOfArxivId } from "../src/plugins/lookup";

describe("identifiers", () => {
  it("finds arXiv ids in ids and links", () => {
    expect(arxivId("2106.09685")).toBe("2106.09685");
    expect(arxivId("https://arxiv.org/abs/2106.09685v3")).toBe("2106.09685");
    expect(arxivId("https://arxiv.org/pdf/1706.03762v7.pdf")).toBe("1706.03762");
    expect(arxivId("arXiv:hep-th/9711200")).toBe("hep-th/9711200");
    expect(arxivId("10.1103/PhysRevLett.116.061102")).toBeNull();
  });

  it("finds DOIs in DOIs and publisher links, but leaves arXiv DOIs to arXiv", () => {
    expect(doiOf("10.1103/PhysRevLett.116.061102")).toBe("10.1103/PhysRevLett.116.061102");
    expect(doiOf("https://doi.org/10.1038/nature14539.")).toBe("10.1038/nature14539");
    expect(doiOf("https://www.nature.com/articles/10.1038/s41586-021-03819-2/pdf")).toBe("10.1038/s41586-021-03819-2");
    expect(doiOf("10.48550/arXiv.1706.03762")).toBeNull();
  });

  it("reads the year from an arXiv id", () => {
    expect(yearOfArxivId("1706.03762")).toBe(2017);
    expect(yearOfArxivId("hep-th/9711200")).toBe(1997);
  });

  it("rebuilds OpenAlex abstracts", () => {
    expect(invertedToText({ light: [0], cones: [1, 3], and: [2] })).toBe("light cones and cones");
  });
});
