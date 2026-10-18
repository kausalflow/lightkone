import { describe, expect, it } from "vitest";
import { entryToDraft, libraryToBibtex, parseBibtex, parseBibtexToDrafts, plain, splitAuthors } from "../src/core/bibtex";
import { Library } from "../src/core/library";

const SAMPLE = String.raw`
@string{prl = "Physical Review Letters"}
% a comment line
@ARTICLE{Parrochia2019-pq,
  title         = "Some remarks on history and pre-history of Feynman path
                   integral",
  author        = "Parrochia, Daniel",
  journal       = "arXiv [physics.hist-ph]",
  abstract      = "One usually refers the concept of Feynman path integral to
                   the work of {Norbert Wiener} on Brownian motion.",
  month         =  "20~" # jun,
  year          =  2019,
  url           = "http://arxiv.org/abs/1907.11168",
  file          = "All Papers/physics/Parrochia 2019 - Some remarks.pdf",
  keywords      = "path integral;history",
  archivePrefix = "arXiv",
  primaryClass  = "physics.hist-ph",
  eprint        = "1907.11168"
}

@inproceedings{Vaswani2017,
  title = {Attention Is All You Need},
  author = {Ashish Vaswani and Noam Shazeer and others},
  booktitle = {Advances in Neural Information Processing Systems},
  year = {2017},
  pages = {5998--6008},
  doi = {10.48550/arXiv.1706.03762},
}

@article(Abbott2016,
  title = {Observation of {Gravitational Waves} from a Binary Black Hole Merger},
  author = {Abbott, B. P. and {LIGO Scientific Collaboration}},
  journal = prl,
  volume = 116,
  doi = {https://doi.org/10.1103/PhysRevLett.116.061102},
  year = 2016
)
`;

describe("parseBibtex", () => {
  const entries = parseBibtex(SAMPLE);

  it("reads every entry, with either delimiter", () => {
    expect(entries.map((e) => e.key)).toEqual(["Parrochia2019-pq", "Vaswani2017", "Abbott2016"]);
  });

  it("handles concatenation, months and macros", () => {
    expect(entries[0].fields.month).toBe("20~June");
    expect(entries[2].fields.journal).toBe("Physical Review Letters");
    expect(entries[2].fields.volume).toBe("116");
  });

  it("keeps nested braces inside values", () => {
    expect(entries[2].fields.title).toBe("Observation of {Gravitational Waves} from a Binary Black Hole Merger");
  });
});

describe("entryToDraft", () => {
  const [pp, vaswani, abbott] = parseBibtex(SAMPLE).map(entryToDraft);

  it("maps Paperpile fields", () => {
    expect(pp.title).toBe("Some remarks on history and pre-history of Feynman path integral");
    expect(pp.arxiv).toBe("1907.11168");
    expect(pp.tags).toEqual(["path integral", "history"]);
    expect(pp.file).toMatch(/^All Papers\//);
    expect(pp.year).toBe(2019);
    expect(pp.fields!.archiveprefix).toBeUndefined();
    expect(pp.fields!.month).toBe("20~June");
  });

  it("normalizes authors and DOIs", () => {
    expect(vaswani.authors).toEqual(["Vaswani, Ashish", "Shazeer, Noam", "others"]);
    expect(vaswani.venue).toBe("Advances in Neural Information Processing Systems");
    expect(abbott.doi).toBe("10.1103/PhysRevLett.116.061102");
    expect(abbott.authors).toEqual(["Abbott, B. P.", "LIGO Scientific Collaboration"]);
  });
});

describe("round trip", () => {
  it("writes BibTeX that reads back to the same papers", () => {
    const lib = new Library();
    lib.merge(parseBibtexToDrafts(SAMPLE));
    const again = parseBibtexToDrafts(libraryToBibtex(lib.papers));
    expect(again.map((d) => [d.key, d.title, d.authors, d.year, d.doi, d.arxiv, d.tags])).toEqual(
      lib.papers.map((p) => [p.key, plain(p.title), p.authors, p.year, p.doi, p.arxiv, p.tags]),
    );
  });

  it("escapes special characters", () => {
    const lib = new Library();
    lib.merge([{ title: "Q & A: 100% sure", authors: ["Doe, Jane"], year: 2020 }]);
    expect(libraryToBibtex(lib.papers)).toContain("Q \\& A: 100\\% sure");
  });
});

describe("helpers", () => {
  it("strips braces and common escapes", () => {
    expect(plain("{REALM}: Retrieval-Augmented \\& \\emph{fast}")).toBe("REALM: Retrieval-Augmented & fast");
  });
  it("turns LaTeX accents into letters", () => {
    expect(plain('B\\"orsenhandel, Schr{\\"o}dinger, Erd\\H{o}s, \\v{C}ech, G\\\'{e}rard, Stra\\ss e')).toBe("Börsenhandel, Schrödinger, Erdős, Čech, Gérard, Straße");
  });
  it("flips First Last names", () => {
    expect(splitAuthors("Richard P. Feynman and Dirac, P. A. M.")).toEqual(["Feynman, Richard P.", "Dirac, P. A. M."]);
  });
});
