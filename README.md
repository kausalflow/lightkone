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
  Unpaywall's open-access copies.
- **AI built in, with your own key.** Summaries and questions about a paper with
  Claude. When the PDF is stored, Claude reads the whole paper.
- **Plugins.** Storage, lookups, importers and paper actions are all plugins,
  including the built-in ones. Load your own from a URL.
- **Cheap to run.** A static site with no server. One person or a small team can
  host it for free on Cloudflare Pages with R2, or on any static host.

## Quick start

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # type check and tests
npm run build      # static site in dist/
```

Open Settings to choose where the library lives. "This browser only" works with
no setup. See [docs/STORAGE.md](docs/STORAGE.md) for R2, S3 and GitHub.

## Moving from Paperpile

Either import Paperpile's BibTeX export with **Add paper → Import a .bib file**,
or, if Paperpile already syncs BibTeX to a GitHub repository, choose GitHub
storage, point it at that repository and set the `.bib` folder (for example
`paperpile`). Lightkone then picks up every paper Paperpile adds until you
switch over. PDFs are filed exactly as Paperpile files them in Google Drive
(`Paperpile/All Papers/HINTON/Hinton et al. 2012 - ....pdf`), so copy that folder
into your bucket once and every paper finds its PDF (see
[docs/STORAGE.md](docs/STORAGE.md#moving-pdfs-over-from-paperpile)).

## Search

Words match titles, authors, abstracts, venues, tags and notes. Filters:
`tag:"machine learning"`, `author:hinton`, `year:2015-2020`, `has:pdf`,
`has:abstract`, `has:arxiv`, `has:notes`.

## More

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it fits together, and what comes next
- [docs/PLUGINS.md](docs/PLUGINS.md): writing a plugin
- [docs/STORAGE.md](docs/STORAGE.md): setting up each storage backend
- [docs/HOSTING.md](docs/HOSTING.md): deploying to Cloudflare Pages or any static host
