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

## Setting it up on Cloudflare Pages

The server reads the library straight from your R2 bucket, so the Pages
project needs the bucket and a secret token.

1. Make a long random token, for example with `openssl rand -hex 24`.
2. In Cloudflare, open **Workers & Pages → lightkone → Settings**:
   - **Variables and Secrets → Add**: type **Secret**, name `MCP_TOKEN`, value
     the token.
   - **Bindings → Add → R2 bucket**: variable name `LIBRARY`, your library's
     bucket.
3. Redeploy: **Deployments →** the latest one **→ Retry deployment** (or merge
   anything to `main`).

Your MCP address is `https://<your site>/mcp/<token>`.

## Connecting

- **claude.ai and the Claude apps:** Settings → Connectors → **Add custom
  connector**, paste the address.
- **Claude Code:** `claude mcp add --transport http lightkone https://<your site>/mcp/<token>`

The address is the key: anyone who has it can read and change your library.
Keep it private, and to revoke it change `MCP_TOKEN` and redeploy.

## Notes

- Changes made through MCP appear in the app the next time it opens the
  library. If the app and an AI app save at the same moment, the later save
  wins; Phase 5 adds version checks.
- Libraries kept in a GitHub repository or only in a browser are not reachable
  by the server.
