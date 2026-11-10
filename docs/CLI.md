# The command line

The `lightkone` command and Python package read and write the same files as
the web app, wherever your library lives, so you can switch between the
browser, the terminal and a notebook freely. Its code is in the `cli/` folder
of this repository. `kirsche` is a second name for the command, after the
citation-graph tool it grew from.

## Set up

```bash
pipx install lightkone        # or pip install lightkone
```

The quickest way to point it at your library is a settings backup from the
web app: **Settings → Backup → Export settings**. Then

```bash
lightkone login --from-backup lightkone-settings-2026-11-10.json
```

Only where the library lives (and an OpenAlex key, if you set one) is kept, in
`~/.config/lightkone/config.json`, readable by you only. An encrypted backup asks
for its passphrase (install `lightkone[crypto]` for that).

Or set it up by hand:

```bash
lightkone login --provider s3       # endpoint, bucket, region, folder, access key, secret
lightkone login --provider github   # owner/name, a fine-grained token, branch
lightkone login lab --provider folder --set path=~/papers
```

Several libraries can be kept under names: `lightkone libraries`, `lightkone use lab`,
or `-L lab` on any command. `--dir PATH` (or `LIGHTKONE_DIR`) uses a folder
directly, for example a clone of the library's GitHub repository.

A library kept only in a browser can't be reached from the command line; move
it to a bucket or repository first.

## Find and read

```bash
lightkone ls                                   # newest first
lightkone ls gravitational lensing             # best match first
lightkone ls author:einstein year:1915-1920 -o bib
lightkone ls in:Physics/QFT is:starred has:pdf
lightkone show Hinton2012-in
lightkone text Hinton2012-in | grep -i dropout # once the reader has extracted it
lightkone highlights Hinton2012-in -o markdown
lightkone pdf Hinton2012-in --open
```

The search syntax is the app's: words anywhere, `tag:"a b"`, `author:`,
`year:2019` or `year:2015-2020`, `in:Folder/Sub`, `is:starred|recent|trash`,
`has:pdf|abstract|arxiv|notes` and `no:` for the opposite.

## Open in the browser

```bash
lightkone web                          # the Lightkone app
lightkone open Hinton2012-in           # the paper's details
lightkone open Hinton2012-in -p 3      # its reader at page 3
```

`--url` (or `LIGHTKONE_URL`) points at another Lightkone, such as your own
deployment or staging. The browser uses the library set up in its own
Lightkone Settings.

## Add and organise

```bash
lightkone add 2106.09685 10.1103/PhysRevLett.116.061102 -t lensing -f Physics/GR
lightkone import paperpile.bib --dry-run
lightkone tag Hinton2012-in -a dropout -r todo
lightkone tag -q 'author:einstein year:1915' -a classics
lightkone folder -q tag:lensing -a Physics/GR
lightkone note Hinton2012-in "Compare with DropConnect."
lightkone star Hinton2012-in
lightkone trash Hinton2012-in              # --restore to take it back
lightkone attach Hinton2012-in ~/Downloads/1207.0580.pdf
```

Each change is saved straight away. Before writing, the library is read again
and anything saved elsewhere since (in the app, by Claude through MCP, or by
another run) is merged in field by field, the way the app does it.

## Export

```bash
lightkone export -o library.bib
lightkone export in:Thesis -o thesis.bib
lightkone export tag:lensing -f csv -o lensing.csv
```

## The citation map

```bash
lightkone map                        # citation-map.html for the whole library
lightkone map in:Thesis --open
lightkone map tag:lensing -o lensing.json --linked-only
lightkone missing in:Thesis --min 3  # what your thesis papers keep citing that you lack
lightkone missing --add -t to-read
```

References come from OpenAlex and are kept in `lightkone/citations.json`, shared
with the web app's Citation map, so each paper is looked up once. OpenAlex's free
budget is per network; for a budget of your own pass `--openalex-key` or set
`OPENALEX_API_KEY`. The page draws papers across by year and up by how often they
are cited, in bands by folder; tap a paper to see its links.
The JSON has `nodes` and `edges` for networkx, Gephi or D3.

## In Python

```python
from lightkone import Library, S3Storage

lib = Library(S3Storage(endpoint="https://<account>.r2.cloudflarestorage.com", bucket="papers",
                        access_key_id="...", secret_access_key="...")).load()
recent = lib.search("year:2024-2026 has:pdf", sort="year")
df = lib.to_dataframe(recent, columns=["key", "title", "year", "tags"])
```

Papers are plain dicts in the shape of Lightkone's `Paper` record, so fields
this version does not know survive a save.

## Raw data, drawn your way

The built-in page is only one way to look at the map. Everything behind it is
yours to load and plot however you like:

```python
from lightkone import FolderStorage, Library

lib = Library(FolderStorage("~/papers")).load()

lib.papers                          # every record, as dicts
lib.to_dataframe()                  # papers as a pandas DataFrame (pip install "lightkone[data]")
lib.citations()                     # raw lightkone/citations.json: OpenAlex id, year, cited count, references

g = lib.citation_graph("in:Thesis", fetch=True)   # fetch=True looks up what's new on OpenAlex
nodes, edges = g.to_dataframes()    # pandas: one row per paper, one per link (source cites target)
G = g.to_networkx()                 # networkx DiGraph (pip install "lightkone[graph]")
g.to_json()                         # plain nodes/edges
g.missing                           # [(OpenAlex id, [ids of your papers citing it]), ...]
```

From the command line, `lightkone map` writes the same data as `.json`,
`.graphml` or `.gexf` (Gephi, Cytoscape, networkx) or `.csv` (nodes, plus
`-edges.csv`). `lightkone ls -o json` and `lightkone export -f csv` give the paper
records.
