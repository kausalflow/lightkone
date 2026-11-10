---
name: lightkone
description: Work with the user's Lightkone paper library (their reference manager) to find, read, cite, organise and grow it. Use when they ask about papers they have or have read, want citations or BibTeX for a draft, want a paper explained, or ask what they're missing, and Lightkone's MCP tools or the `lightkone` CLI are available.
---

# Lightkone

Lightkone is the user's own reference manager. Each paper has a citation key,
tags, folders, notes, highlights and often a PDF whose text has been extracted.
Treat the library as the user's reading record: what they have read and what
they think of it.

## Reaching the library

- **MCP tools** (from the site's connector or from `lightkone mcp`): `search_papers`,
  `get_paper`, `read_paper`, `list_tags`, `search_full_text`, `get_citations`,
  `find_missing_papers`, `list_branches`, `export_bibtex`, `add_paper`, `tag_papers`, `add_note`.
- **CLI**, when there are no MCP tools but there is a shell: `lightkone ls <query>`,
  `lightkone show KEY` (`-o json` or `-o bib`), `lightkone export <query> -o refs.bib`,
  `lightkone missing`, `lightkone add <doi|arxiv> -t tag`, `lightkone tag KEY -a tag`,
  `lightkone note KEY "text"`. Add `-L <library>` or `--dir <folder>` for another library.

## Search syntax

Plain words match the title, authors, abstract, tags and notes. Filters:
`tag:x`, `author:x`, `year:2020`, `year:2015-2020`, `in:"Folder/Sub"`, `has:pdf`,
`has:notes`, `is:starred`, `is:recent`. Try a few wordings before saying the
library has nothing. Use `search_full_text` for terms that only appear in the
body, like a method name or a symbol. Narrow it with `within` (a search query).

## How to work

1. **Search first.** Before answering about "my papers" or "what I read", search the library.
2. **Cite by key.** Name papers by citation key, title and year, and write `\cite{key}`
   in LaTeX. Only cite papers that are in the library unless the user asks for more.
3. **Check the text.** Before saying a paper supports a claim, read the relevant pages
   (`read_paper` with `from_page`/`to_page`, or a `search_full_text` hit). Abstracts overstate.
4. **Use their notes.** `get_paper` returns the user's notes and highlights. Bring them in
   ("you noted…"), because they show what the user already thinks.
5. **Connections.** `get_citations` shows which library papers a paper cites or is cited by.
   `find_missing_papers` and `list_branches` suggest what to read next. These rely on the
   citation map the user opened in Lightkone (or `lightkone map`). If they're empty, say so.
6. **Ask before changing.** Adding papers, tagging and notes change the user's library.
   Do them when asked, and otherwise propose them and wait. Keep notes short and dated if useful.
7. **BibTeX.** Use `export_bibtex` with the keys you cited, or a query, and don't write BibTeX by hand.

## Audience

The user is a researcher. Explain at graduate level and keep the math. Skip the hype.

## Limits

- Full text exists only for papers whose PDF Lightkone has opened or indexed. If it's
  missing, `read_paper` says so and gives the arXiv link or DOI.
- Equations from PDF text can be garbled. For arXiv papers, the HTML version at
  `https://arxiv.org/html/<id>` usually has clean math.
- The site's connector searches at most 40 texts per `search_full_text` call. The local
  `lightkone mcp` has no limit.
