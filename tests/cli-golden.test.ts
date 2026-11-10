// The Python CLI in cli/ reads and writes the same files as the app. Its
// parity tests (cli/tests/test_parity.py) compare against what this code
// produces for the inputs below, kept in cli/tests/data/golden.json.
// This test fails when the app's output changes; then run
//   UPDATE_GOLDEN=1 npx vitest run tests/cli-golden.test.ts
// and bring the Python side in line (cd cli && pytest).
import { expect, test } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseBibtexToDrafts, libraryToBibtex, plain, splitAuthors } from "../src/core/bibtex";
import { makeKey } from "../src/core/library";
import { search } from "../src/core/search";
import { mergeLibraries } from "../src/core/merge";
import { paperpileFile } from "../src/core/filing";
import { foldersFromPaperpile } from "../src/core/folders";
import { buildGraph } from "../src/core/citations";

const BIB = String.raw`
@string{prl = "Physical Review Letters"}
@article{Abbott2016-ob,
  title = {Observation of Gravitational Waves from a Binary Black Hole Merger},
  author = {{LIGO Scientific Collaboration} and Abbott, B. P. and Kip S. Thorne},
  journal = prl, year = 2016, month = feb, volume = {116},
  doi = {https://doi.org/10.1103/PhysRevLett.116.061102},
  keywords = {gravitational waves; LIGO, doi:10.1103/x},
  file = {All Papers/ABBOTT/Abbott et al. 2016 - Observation.pdf}
}
@inproceedings{Erd\H{o}s1959,
  title = "On Random {G}raphs \& the 100\% rule",
  author = {Erd{\H o}s, Paul and R\'{e}nyi, Alfr\'ed},
  booktitle = {Proc. {Hung}. Acad.} # " Sci.",
  year = {1959}, note = {classic}
}
@misc{hu2021lora,
  title={{LoRA}: Low-Rank Adaptation of Large Language Models},
  author={Edward J. Hu and Yelong Shen and Phillip Wallis},
  year={2021}, eprint={2106.09685v2}, archivePrefix={arXiv}, primaryClass={cs.CL},
  file = {All Papers/ML/Transformers/Hu et al. 2021 - LoRA.pdf}
}
@article{bad, title = {Broken {entry}, author = }
@book{Weinberg1995,
  title = {The Quantum Theory of Fields},
  editor = {Weinberg, Steven},
  publisher = {Cambridge University Press},
  journal = {},
  year = {c1995},
  url = {https://arxiv.org/abs/hep-th/9702027v1}
}
@comment{ignored}
@article{noauthor, title={Ünïcode tïtle — with dash}, year={2020}}
`;

const GOLDEN = fileURLToPath(new URL("../cli/tests/data/golden.json", import.meta.url));

test("the Python CLI's golden outputs match the app", () => {
  const drafts = parseBibtexToDrafts(BIB);
  const taken = new Set<string>();
  const keys = drafts.map((d) => { const k = makeKey(d, taken); taken.add(k); return k; });
  const extra = [
    { title: "A study of things", authors: ["Müller, Jörg"], year: 2001 },
    { title: "A study of things", authors: ["Müller, Jörg"], year: 2001 },
    { title: "x", authors: [] },
    { title: "Dark matter halos and their sub structure", authors: ["Navarro, J"], year: 1996 },
  ];
  const t2 = new Set<string>();
  const extraKeys = extra.map((d) => { const k = makeKey(d as any, t2); t2.add(k); return k; });
  const papers = drafts.map((d, i) => ({
    type: "article", authors: [], fields: {}, ...d, tags: d.tags ?? [], folders: foldersFromPaperpile(d.file, d.authors),
    id: `id${i}`, key: keys[i], added: `2026-01-0${i + 1}T00:00:00.000Z`,
  })) as any[];
  papers[0].starred = true;
  papers[1].trashed = "2026-02-01T00:00:00.000Z";
  papers[2].opened = "2026-03-01T00:00:00.000Z";
  papers[2].pdf = "papers/x.pdf";
  papers[3].notes = "Read chapter 2";
  const queries = ["", "gravitational", "author:erdos", "author:\"renyi\"", "is:trash", "is:starred", "is:recent", "has:pdf", "no:pdf",
    "year:2016", "year:1990-2021", "tag:ligo", "tag:\"gravitational waves\"", "in:ML", "in:\"ML/Transformers\"", "lora low rank", "has:notes", "quantum fields", "unicode", "no:abstract has:arxiv"];
  const searches: Record<string, string[]> = {};
  for (const q of queries) for (const s of ["added", "year", "title"] as const) searches[`${q}|${s}`] = search(papers, q, s).map((p) => p.key);
  const file = { format: "lightkone-library", version: 1, papers };
  // merges
  const base = { format: "lightkone-library", version: 1, papers: [
    { id: "a", key: "A", title: "A", tags: ["x", "y"], folders: [], added: "t" },
    { id: "b", key: "B", title: "B", tags: [], added: "t" },
    { id: "c", key: "C", title: "C", tags: [], added: "t", notes: "n" },
    { id: "d", key: "D", title: "D", tags: [], added: "t" },
  ] } as any;
  const ours = { format: "lightkone-library", version: 1, papers: [
    { id: "a", key: "A", title: "A ours", tags: ["x", "z"], folders: ["F"], added: "t" },
    { id: "c", key: "C", title: "C", tags: [], added: "t", notes: "n" },
    { id: "d", key: "D", title: "D", tags: [], added: "t", starred: true },
    { id: "e", key: "E", title: "E new here", tags: [], added: "t" },
  ] } as any;
  const theirs = { format: "lightkone-library", version: 1, bibSync: [{ folder: "", repo: "o/r", path: "x.bib" }], papers: [
    { id: "f", key: "F", title: "F new there", tags: [], added: "t" },
    { id: "a", key: "A", title: "A", tags: ["y", "w"], folders: [], added: "t", year: 2000 },
    { id: "b", key: "B", title: "B changed", tags: [], added: "t" },
    { id: "c", key: "C", title: "C", tags: [], added: "t", notes: "n2" },
  ] } as any;
  const merged = mergeLibraries(base, ours, theirs);
  const store = { format: "lightkone-citations", version: 1, works: {
    id0: { oa: "W0", year: 2016, cited: 5000, refs: ["W2", "W9", "W8"], at: "t" },
    id2: { oa: "W2", year: 2021, cited: 300, refs: ["W9", "W8", "W4"], at: "t" },
    id3: { oa: "W4", cited: 10, refs: ["W9", "W0", "W0"], at: "t" },
    id5: { oa: null, refs: [], at: "t" },
  } } as any;
  const g = buildGraph(papers, store);
  const graph = { edges: g.edges, missing: g.missing, known: g.known, nodes: [...g.nodes.values()].map((n) => ({ id: n.paper.id, year: n.year, cited: n.cited, cites: n.cites, citedBy: n.citedBy })) };
  const filing = papers.map((p) => paperpileFile(p)).concat([
    paperpileFile({ authors: [], title: "Untitled: a note/on things?", year: undefined }),
    paperpileFile({ authors: ["O'Neil, Cathy", "Doe, J"], title: "Weapons", year: 2016 }),
    paperpileFile({ authors: ["Smith, A"], title: "x".repeat(200), year: 2000 }),
  ]);
  const folderCases = [["All Papers/HINTON/Hinton 2012.pdf", ["Hinton, G"]], ["All Papers/MLDS/Physics/a.pdf; All Papers/Other/b.pdf", []], ["All Papers/ML/a.pdf", ["Smith, J"]], ["All Papers/SMITH/a.pdf", []]] as const;
  const folders = folderCases.map(([f, a]) => foldersFromPaperpile(f, [...a]));
  const plains = ["{\\\"a}bc", "\\'{e}t\\'e", "Erd{\\H o}s", "{\\ss}e \\o{}", "\\emph{x} 50\\% \\& more", "a~b  {C}", "na\\\"{\\i}ve", "\\c{c}a"];
  const golden = {
    bib: BIB, drafts, keys, extra, extraKeys, papers, libraryBib: libraryToBibtex(papers), searches,
    libraryJson: JSON.stringify(file, null, 1), merge: { base, ours, theirs, merged }, store, graph, filing, folderCases, folders,
    plains: plains.map((s) => [s, plain(s)]), authors: ["Hu, E and {Big Org} and others and John von Neumann"].map((s) => [s, splitAuthors(s)]),
  };
  if (process.env.UPDATE_GOLDEN) writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + "\n");
  expect(JSON.parse(JSON.stringify(golden))).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
});