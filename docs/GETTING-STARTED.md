# Getting started

## 1. Open Lightkone

Open your Lightkone site in a browser. Its front page says what Lightkone
is; **Open Lightkone** takes you to the app, which lives at `/app/` (for
example `https://lightkone.lab.kausalflow.com/app/`). Bookmark that address to go
straight to your library next time. There is no account to create. The
first time, a short tour explains the basics. A new library starts with two
example papers, *Attention Is All You Need* and *Transformer models: an
introduction and catalog*, tagged **Example**, so there is something to read
and highlight right away. **Remove them** (above the list) whenever you like.
They don't come back.

On a phone, use the browser menu's **Install app** (Chrome) or **Add to Home
Screen** (Safari). Installed, Lightkone opens like an app, works offline with
your library and recent PDFs, and appears in the share menu so you can send
it papers.

## 2. Choose where your library lives

At first the library is kept in this browser only. That is fine for a look
around. For a library you mean to keep, open **Settings** and choose a
bucket (Cloudflare R2, AWS S3, MinIO) or a private GitHub repository, so it
is safe and on every device. [Where your library lives](STORAGE.md) walks
through each one. Do this before adding much: Lightkone can't yet move a
whole library from the browser to other storage.

## 3. Add papers

Press **Add paper** (or **+** on a phone) and paste any of these, one per
line:

- an arXiv id or link: `2106.09685`, `https://arxiv.org/abs/1706.03762`
- a DOI or doi.org link: `10.1103/PhysRevLett.116.061102`
- a publisher's page for the paper
- any other web page: a blog post, a report, documentation
- BibTeX entries

Details come from arXiv, Crossref, Semantic Scholar and OpenAlex. Free PDFs
are downloaded for you: from arXiv always, and from open-access copies once
you give a contact email under **Settings → PDFs**.

Have the PDF already, from a journal you subscribe to say? Use **Add PDF
files**, or drop the files anywhere on Lightkone. Each one is identified from
the DOI or arXiv id printed on its first page (or by Claude reading that page,
with a key), added, and filed with its PDF. A PDF for a paper already in your
library is attached to it.

A web page that isn't a paper is added with its own title, authors and date,
and saved: its raw HTML as it came, and its main text as Markdown, with
figures, links and math kept. **Read** shows the Markdown as a clean page, and
**Saved page** shows the page as it was saved. A web page already in your
library, from a .bib file say, has **Save page** to do the same. See
[Saved web pages](READING.md#saved-web-pages).

To bring a whole library, use **Import a .bib file** in the same panel. Coming
from Paperpile, follow [Moving from Paperpile](PAPERPILE.md) for your PDFs and
folders as well.

## 4. Read

Open a paper and press **Read**. Select text to **Highlight** it, add a note,
or (with a Claude key) **Explain** it. See [Reading and highlighting](READING.md).

## 5. Add a Claude key (optional)

Ask, Compare papers, Explain, Summarize, Cite this's check, and finding papers from a plain
description use Claude with your own key. Get one at
[console.anthropic.com](https://console.anthropic.com) and paste it under
**Settings → Claude → Anthropic API key**. It is kept in this browser only and
sent only to Anthropic. Everything else works without it.

## Finding your way

- **Ctrl K** (⌘K on a Mac), or the ⌘ button at the top, opens a command list:
  type to jump to any tool, folder, tag or paper.
- The side bar holds your folders and tags, and the tools grouped as
  *Discover*, *Write* and *Organize*.
- **?** opens Help.
