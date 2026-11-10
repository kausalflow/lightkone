# Lightkone CLI

The command line and Python package for [Lightkone](https://lightkone.lab.kausalflow.com),
the web reference manager. It works on the same library as the web app: the
plain files in your Cloudflare R2 / S3 bucket, your GitHub repository, or a
folder on disk. Search, add, tag, file, annotate, export BibTeX and draw the
citation map from the terminal, a script or a notebook.

```bash
pipx install lightkone               # or: pip install lightkone
lightkone setup                      # set up a bucket or repo: check it, add CORS, file for the web app
lightkone login --from-backup lightkone-settings.json   # or: Lightkone → Settings → Backup → Export settings
lightkone ls author:hinton year:2010-2015
lightkone add 2106.09685 10.1103/PhysRevLett.116.061102 -t lensing -f Physics/GR
lightkone export in:Thesis -o thesis.bib
lightkone map in:Thesis --open        # which of your papers cite which
lightkone open Hinton2012-in -p 3     # read it in the web app, at page 3
claude mcp add lightkone -- lightkone mcp   # let Claude Code search and cite your library
```

Extras: `lightkone[data]` (pandas DataFrames), `lightkone[graph]` (networkx,
GraphML and GEXF), `lightkone[crypto]` (encrypted settings backups), or
`lightkone[all]`.

The full guide is at <https://lightkone.lab.kausalflow.com/docs/cli.html>
(`docs/CLI.md` in the repository).

## Working on it

```bash
cd cli
pip install -e ".[dev]"
pytest
```

`tests/data/golden.json` holds what Lightkone's TypeScript code produces for
the same inputs (BibTeX parsing, citation keys, `library.json` and
`library.bib` text, search, merging, filing, the citation graph). It is
written by `tests/cli-golden.test.ts` in the app's tests, and `npm run check`
fails when the app's output no longer matches it. After changing one of those
formats in the app, run `UPDATE_GOLDEN=1 npx vitest run tests/cli-golden.test.ts`
and make the Python side pass `pytest` again.

## License

Apache-2.0 (see the `LICENSE` and `NOTICE` files that come with it). The Lightkone web
app in the rest of this repository is under AGPL-3.0.
