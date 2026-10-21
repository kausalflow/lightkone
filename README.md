# Lightkone

A web library for research papers that you own. Collect papers, tag and search
them, cite them from LaTeX, and ask Claude about them, with the library kept as
plain files in storage you choose.

- **Your storage, open files.** The library is `lightkone/library.json` plus a
  `library.bib` that is rewritten on every save, so LaTeX and Overleaf can use it
  directly. PDFs and highlights sit next to it. Storage is a plugin: this browser, any
  S3-compatible bucket (Cloudflare R2, AWS S3, MinIO), or a private GitHub repo.
- **Add papers the quick way.** Paste DOIs, arXiv ids or links, or BibTeX, or
  import a `.bib` file. Metadata comes from Crossref, Semantic Scholar and
  OpenAlex.
- **Read and highlight.** A PDF reader that works on a phone, with highlights,
  notes, dark pages for night reading, and export to Markdown (Obsidian).
  Free PDFs are fetched when you add a paper: arXiv directly, others through
  Unpaywall's open-access copies. Select a passage or an equation and tap
  **Explain**: Claude explains it in the context of the whole paper (it sees the
  PDF and a picture of the selection), takes follow-up questions, and can keep
  the answer as the highlight's note.
- **AI built in, with your own key.** Summaries and questions about a paper with
  Claude. When the PDF is stored, Claude reads the whole paper.
- **Your library in Claude (MCP).** Connect Claude, Claude Code or any MCP app
  to search your library, read papers and your highlights, and add or tag
  papers. See [docs/MCP.md](docs/MCP.md).
- **Plugins.** Storage, lookups, importers and paper actions are all plugins,
  including the built-in ones. Load your own from a URL.
- **Cheap to run.** A static site with no server. One person or a small team can
  host it for free on Cloudflare Pages with R2, or on any static host.

## Quick start

```sh
npm install
npm run dev        # landing page at http://localhost:5173, the app at /app/
npm run check      # type check and tests
npm run build      # static site in dist/
```

Open Settings to choose where the library lives. "This browser only" works with
no setup. See [docs/STORAGE.md](docs/STORAGE.md) for R2, S3 and GitHub.
Settings stay in this browser; **Settings → Backup** saves them to a file
(encrypted if you give a passphrase) to restore here or on another device.

## Adding papers from anywhere

- **On Android**, open Lightkone in Chrome and choose **Install app**. It then
  appears in the share menu: share a paper's page (or an arXiv or DOI link) to
  Lightkone and it is added.
- **On a computer**, drag the **+ Lightkone** link from the Add panel to the
  bookmarks bar. On a paper's page it reads the citation tags most publishers
  and arXiv provide and adds the paper.
- **With a Claude key**, a link without a DOI, or a plain description ("the
  2017 transformer paper by Vaswani"), is found by Claude with web search.

The installed app opens offline with the library and the last 25 PDFs you
opened.

## Moving from Paperpile

[docs/PAPERPILE.md](docs/PAPERPILE.md) walks through it step by step for each
kind of storage. In short: either import Paperpile's BibTeX export with **Add paper → Import a .bib file**,
or, if Paperpile already syncs BibTeX to a GitHub repository, choose GitHub
storage, point it at that repository and set the `.bib` folder (for example
`paperpile`). Lightkone then picks up every paper Paperpile adds until you
switch over. PDFs live under `papers/`, filed exactly as Paperpile files them in Google Drive
(`papers/All Papers/HINTON/Hinton et al. 2012 - ....pdf`), so copy Paperpile's
`All Papers` folder into `papers/` once and every paper finds its PDF (see
[docs/STORAGE.md](docs/STORAGE.md#moving-pdfs-over-from-paperpile)).

## Search

Words match titles, authors, abstracts, venues, tags and notes. Filters:
`tag:"machine learning"`, `author:hinton`, `year:2015-2020`, `has:pdf`,
`has:abstract`, `has:arxiv`, `has:notes`, `in:"Physics/QFT"` (a folder and
the folders inside it), `is:starred`, `is:recent`, `is:trash`.

## Organizing

Papers can be starred, put in nested folders (a paper can be in several), and
moved to the trash, where they wait until you restore them or empty it.
"Recently read" lists what you opened in the reader. Papers imported from
Paperpile land in the folders their PDFs were filed under in Google Drive
(`All Papers/MLDS/Statistics/...` puts a paper in `MLDS/Statistics`); the
author folders Paperpile makes are not folders of yours and are skipped. On a
phone, **Browse** opens the folders and tags.

## Tidying up

**Tidy up** in the sidebar finds the same paper entered twice (same DOI, arXiv
id or title) and merges each group into the copy with a PDF, keeping every
tag, folder and note; the others go to the trash. It also checks your arXiv
preprints for published versions and fills in the journal, DOI, volume and
pages, keeping citation keys as they are.

## LaTeX and Overleaf

`lightkone/library.bib` is rewritten on every save. To keep a folder's papers
in a GitHub repository instead (Overleaf's GitHub sync, or your paper's own
repository), open the folder and choose **Sync .bib**: pick the repository and
file, and Lightkone rewrites it whenever those papers change. Citation keys
never change once given. Add a GitHub token under **Settings → BibTeX sync to
GitHub** first.

## More

The documentation is also served with the app, at `/docs/` (built from `docs/*.md`).

- [docs/README.md](docs/README.md): the documentation's contents
- [docs/PAPERPILE.md](docs/PAPERPILE.md): moving from Paperpile, for each storage
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it fits together, and what comes next
- [docs/PLUGINS.md](docs/PLUGINS.md): writing a plugin
- [docs/STORAGE.md](docs/STORAGE.md): setting up each storage backend
- [docs/HOSTING.md](docs/HOSTING.md): deploying to Cloudflare Pages or any static host
- [docs/RELEASING.md](docs/RELEASING.md): staging on every merge, the live site on a version tag, and how to release
