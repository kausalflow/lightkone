# The command line

The `lightkone` command and Python package read and write the same files as
the web app, wherever your library lives, so you can switch between the
browser, the terminal and a notebook freely. Its code is in the `cli/` folder
of this repository.

## Set up

```bash
pipx install lightkone        # or pip install lightkone
```

### Starting fresh: `lightkone setup`

If you haven't set up storage in the web app yet, let the command line do it:

```bash
lightkone setup
```

It asks for the bucket (or repository), then:

1. looks over what you typed for common slips (the bucket name inside the
   endpoint, a public `r2.dev` address, a region other than `auto` on R2). A
   bare R2 account id is turned into the endpoint for you;
2. checks the storage by listing it and saving, reading back and removing a
   small test file, and says what is wrong if a step fails;
3. for a bucket, checks that the web app may reach it (CORS) and, if not,
   offers to add the rule. The terminal can do this, the browser can't. It
   needs a key allowed to change the bucket's settings (on R2, an *Admin Read
   & Write* token); with an *Object Read & Write* key it prints the rule to
   paste in the dashboard, or a `wrangler` command, instead. Other CORS rules on
   the bucket are kept;
4. saves the library for the command line, and writes
   `lightkone-settings-main.json` for the web app: open Lightkone →
   **Settings → Backup → Import settings**, pick the file, **Save**. It holds
   your keys (readable by you only, or encrypted with `--passphrase`); delete
   it once imported.

Options: `--provider s3|github|folder` and `--set field=value` to skip the
questions, `--origin http://localhost:5173` to also let a local copy in,
`--url` for your own Lightkone site, `--cors/--no-cors`, `--open` to open the
app at the end. Running it again on a working setup only checks.

### From the web app's settings

If the web app is already set up, the quickest way is a settings backup from
it: **Settings → Backup → Export settings**. Then

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

## In Claude and other AI apps

`lightkone mcp` serves the library to Claude Code, Claude desktop or any
[MCP](https://modelcontextprotocol.io) app over standard input and output. The
app starts it itself, so there is nothing to keep running, and it works with
any storage the CLI can reach, a plain folder included.

```bash
claude mcp add lightkone -- lightkone mcp                 # Claude Code, default library
claude mcp add thesis -- lightkone -L thesis mcp          # another library
claude mcp add lab -- lightkone --dir ~/lab-library mcp   # a folder
```

For Claude desktop, add it to `claude_desktop_config.json` (Settings →
Developer → Edit Config):

```json
{ "mcpServers": { "lightkone": { "command": "lightkone", "args": ["mcp"] } } }
```

It has the same tools and prompts as the site's address (see
[MCP](MCP.md)), with no limit on how many texts a full-text search reads.

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
