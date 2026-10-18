# Architecture

Lightkone is a static web app (Preact + TypeScript, built with Vite). There is
no Lightkone server: the browser talks to the storage backend and to public
metadata APIs directly. That keeps hosting free for a person or a small team,
and every part that would need a server later sits behind a plugin interface.

```
src/core/      types, BibTeX, library model, search, plugin registry, settings
src/plugins/   built-in plugins (storage, lookups, related papers, Claude, Dullaby)
src/app.tsx    the interface
```

## Data

The library is these files in the chosen storage:

| Path | What |
| --- | --- |
| `lightkone/library.json` | Source of truth: every paper with its tags, notes and extra BibTeX fields |
| `lightkone/library.bib` | Rewritten on every save, for LaTeX, Overleaf or any other tool |
| `Paperpile/All Papers/<AUTHOR>/<Author> et al. <year> - <title>.pdf` | PDFs, in the same layout Paperpile uses in Google Drive. Each paper's `file` field (also in the `.bib`) is the path under `Paperpile/`, so the folder is interchangeable with Paperpile's |
| `lightkone/annotations/<id>.json` | Highlights and notes on a paper's PDF |

Because these are plain files, a library can always be read without Lightkone,
moved between backends by copying a folder, and versioned (GitHub storage
commits every save).

Saves are debounced and write the whole library. That is fine into the low tens
of thousands of papers; a server mode (below) would switch to per-paper writes.

## Plugins

Everything the app can do beyond its core goes through `LightkonePlugin`
(`src/core/types.ts`): storage providers, lookups (identifier → paper),
importers (text → papers) and paper actions (buttons on a paper). Built-in
plugins use the same interface, and outside plugins load from a URL as ES
modules. See [PLUGINS.md](PLUGINS.md).

## AI

The Claude plugin calls the Anthropic API from the browser with the user's own
key, which is stored in that browser only. It sends the paper's metadata and,
when the PDF is stored in Lightkone, the PDF itself.

## Security model

Settings, storage credentials and API keys stay in the browser's localStorage
and are never written into the library. Lightkone asks the browser to keep that
storage persistent (`navigator.storage.persist()`). **Settings → Backup** exports
them to a JSON file, encrypted with AES-GCM under a PBKDF2 key when a passphrase
is given, and imports such a file on another device. Use credentials scoped to one bucket or
one repository. Plugins loaded from a URL run with full page access, so only
load code you trust.

## Next steps

- **Server mode for teams.** A small optional API (Cloudflare Worker, or Docker
  for self-hosting) that holds the storage credentials, adds sign-in through the
  company's identity provider (OIDC/SAML), shared libraries and per-paper writes.
  The browser storage plugins stay for single users.
- **MCP server.** Expose search, add and cite as MCP tools so Claude and other
  agents can work with the library directly.
- **Google Drive and OneDrive storage**, as plugins over the same file layout.
- **Full-text search** over stored PDFs, and semantic search with embeddings.
- **Browser button** to save the paper on the current page.
