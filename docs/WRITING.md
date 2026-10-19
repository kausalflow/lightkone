# Writing with your library

## Citation keys

Every paper has a BibTeX citation key, such as `Hinton2012-ab`. Imported keys
are kept, new ones are made in Paperpile's style, and a key never changes
once given, so your LaTeX keeps compiling. Tap the key in a paper's details to
copy it.

## Copying a citation

**Cite**, in a paper's details, copies it formatted as a short post line,
APA, Markdown, a LaTeX `\cite{…}`, or a BibTeX entry.

## The library as BibTeX

`lightkone/library.bib` in your storage is rewritten on every save, with the
whole library. The download button at the top exports the papers in the
current view as a .bib, so open a folder or search first to export part of
the library.

## A folder's .bib in GitHub, for Overleaf

Overleaf can pull a .bib from a GitHub repository. Lightkone keeps one up to
date:

1. Make a GitHub token with **Contents: read and write** on the repository
   (see [Private GitHub repository](STORAGE.md#private-github-repository)),
   and add it under **Settings → BibTeX sync to GitHub**. If your library
   itself lives on GitHub and that token can reach the repository, it is
   used when this one is empty.
2. Open a folder (or *All papers*) and press **Sync .bib**. Choose the
   repository and the file path, for example `refs/thesis.bib`.

From then on, whenever papers in that folder change, Lightkone rewrites the
file with a commit. In Overleaf, link the file from GitHub.

## Watch my manuscript

**Watch my manuscript** (side bar, *Write*) keeps a manuscript's .bib in step
with what the manuscript actually cites. Point it at the GitHub repository
and folder holding your .tex files. Lightkone reads every `\cite{…}`, writes
a .bib with exactly those papers, and lists any keys your library doesn't
have so you can add them. Entries already in the .bib for keys your library
lacks are kept as they are. It checks again each time Lightkone opens.

## Writing helpers

**Writing helpers** (side bar, *Write*) has two tools:

- **Cite this**: paste a sentence and get the papers in your library that
  support it, best first. With a Claude key, each suggestion is checked
  against the paper and marked as supporting, related or not.
- **.bib for a .tex**: paste your LaTeX, or open the .tex file, and get a .bib
  with exactly the papers it cites, in the order it cites them.
