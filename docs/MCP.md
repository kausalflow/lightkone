# Lightkone for Claude and other AI apps (MCP)

Lightkone runs a small [MCP](https://modelcontextprotocol.io) server next to
the site, at `/mcp/<token>`. Connected to it, Claude (on claude.ai, the apps or
Claude Code) can work with your library:

| Tool | What it does |
| --- | --- |
| `search_papers` | Search titles, authors, abstracts, tags and notes, with the app's filters (`tag:`, `author:`, `year:`, `has:pdf`). |
| `get_paper` | A paper's record, your notes, your highlights with their notes, and its BibTeX. |
| `read_paper` | The paper's full text, page by page. |
| `list_tags` | Tags and how many papers carry each. |
| `add_paper` | Add a paper by DOI or arXiv id, with tags. |
| `tag_papers` | Add or remove tags on several papers. |
| `add_note` | Append to a paper's notes. |

The full text is extracted from the PDF the first time you open a paper in
Lightkone's reader and saved as `lightkone/text/<id>.txt` next to it.

## Your own address

Anyone using the site can connect their own library, as long as it lives in
an S3/R2 bucket or a GitHub repository:

1. In Lightkone, open **Settings**, set up your storage and save.
2. Under **Claude and other AI apps**, press **Make my AI app address**. The
   site tries your storage once and gives you an address
   `https://<site>/mcp/u1.…`.
3. Add it as a connector (below).

The address carries your storage settings, encrypted with a key that only the
server has. The site keeps no accounts and no copy of anyone's keys: each
request decrypts the address and talks to your storage directly. Anyone who
has the address can read and change your library, so keep it private. To cut
an address off, replace the access key or token in your storage settings and
make a new address.

A library kept only in the browser can't be reached this way.

## For whoever hosts the site

Personal addresses need one secret on the Pages project. In Cloudflare, open
**Workers & Pages → lightkone → Settings → Variables and Secrets → Add**: type
**Secret**, name `MCP_SECRET`, value a long random string (for example from
`openssl rand -hex 32`), then redeploy. If `MCP_SECRET` is not set, the site
uses `MCP_TOKEN` instead. Changing the secret turns off every address made with
it, so set it once and leave it.

### The host's own library, without the app's settings

The host can also serve one library straight from an R2 bucket bound to the
project:

- **Variables and Secrets → Add**: Secret `MCP_TOKEN`, a long random token.
- **Bindings → Add → R2 bucket**: variable name `LIBRARY`, the library's
  bucket.

That library's address is `https://<site>/mcp/<MCP_TOKEN>`. Personal addresses
work without either of these.

## Connecting

- **claude.ai and the Claude apps:** Settings → Connectors → **Add custom
  connector**, paste the address.
- **Claude Code:** `claude mcp add --transport http lightkone <address>`

## Notes

- Changes made through MCP appear in the app when you come back to its tab.
  Every save reads the library again first and merges what was saved
  elsewhere, paper by paper and field by field, so the app and an AI app
  don't overwrite each other. Only when both changed the same field of the
  same paper does the later save's value stay.
- GitHub-backed libraries commit each change through MCP, like the app does.
