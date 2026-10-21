# Reading and highlighting

## The reader

Open a paper and press **Read**. The PDF opens full screen, on a phone too.
Pinch or use **Zoom in / Zoom out**, and the moon button turns the pages dark
for reading at night. **Esc** or the close button returns to the list, where
Lightkone remembers the paper in **Recently read**.

No PDF yet? **Get free PDF** looks for an open copy (arXiv, or Unpaywall with
a contact email set under **Settings → PDFs**). **Attach PDF** adds a file
of your own, and **Replace PDF** swaps it.

## Highlights and notes

Select text on a page, then tap:

- **Highlight** to mark it;
- **Highlight + note** to mark it and write a note;
- **Explain** (with a Claude key) to have Claude explain the passage, or an
  equation, in the context of the whole paper. It sees the PDF and a picture
  of what you selected, takes follow-up questions, and can keep its answer as
  the highlight's note.

Tap a highlight to edit its note or delete it. Highlights are saved in
`lightkone/annotations/<paper id>.json` next to the library, as plain JSON,
and never inside the PDF, so the file stays as published.

The paper's own **Notes** box (in its details) is for notes on the whole
paper. It is searched along with everything else.

## Summaries and questions

With a Claude key, a paper's details offer **Summarize** and **Ask Claude…**.
When the PDF is stored, Claude reads the whole paper, not only the abstract.
To ask across your whole library, use **Ask** at the top (see
[Finding papers](FINDING.md#ask-your-library)).

## Export to Obsidian

**Export to Obsidian** (side bar, *Write*) writes one Markdown note per paper,
named `@<citation key>.md`, with the paper's details, your highlights (each
linking back to its page in Lightkone) and your notes. Choose your vault's
folder to write the notes straight into it (Chrome and Edge), or download a
.zip. Run it again later and only the part above the marker line is
rewritten: what you wrote below it in Obsidian is kept.

## Reading offline

Lightkone keeps the last 25 PDFs you opened on the device. To choose more, for
a flight or a trip, open **Offline papers** (in the side bar under Organize,
or Ctrl/⌘K):

- Pick a folder, tag, **Starred** or a search first. The panel then offers to
  keep every paper in that view, and downloads their PDFs, highlights and
  notes.
- On a single paper, press **Keep offline** in its details.
- Kept papers show an **Offline** label in the list. They stay until you
  remove them, one by one or with **Remove all**.
- They take space on the device, within a limit you set (500 MB to 10 GB,
  2 GB at first). Keeping stops at the limit and says so.

For the app itself to open with no network, install it (**Install app** or
**Add to Home Screen**) and open it once before you go.

With no network you can read, highlight and take notes. Highlights are kept on
the device and saved to your storage when you are back online, even if the app
was closed meanwhile. Other changes (notes, stars, folders) are saved when you
are back online as long as Lightkone stays open; the top bar says
*Offline, saves later* until then.

This applies to a bucket or a GitHub repository. With **This browser only**,
everything is on the device already.

## Saved web pages

A web page added to the library (a blog post, a report, documentation) is
saved twice: its raw HTML exactly as it was fetched, and its main text as
Markdown, found with Mozilla's Readability, the engine behind Firefox's reader
view. **Read** opens the Markdown as a quiet column of text, with headings,
figures, links, tables and math. **Saved page** shows the HTML as it was saved,
in a sandbox where none of the page's scripts run. The moon gives a dark page,
and the toolbar copies or downloads the Markdown, ready for Obsidian.

The Markdown is also the page's text for search, Ask and the MCP server, as a
PDF's text is. Pages that build their content with scripts after they load
may save little text; their raw HTML is kept all the same. Figures stay on the
site they came from, so they show only with a network.

## Reading at night

With the Dullaby plugin set up (**Settings → Dullaby night reading**), **Read
at night** opens a paper in Dullaby's calm, dim reading mode.

The link that opens Dullaby also carries your library, as identifiers only:
arXiv ids (or DOIs), newest first, marked when starred or never opened. No
titles, authors, notes or PDFs. It travels in the part of the address after
`#`, which browsers never send to a server, and Dullaby keeps it on that
device. Dullaby then looks for new papers near yours and skips the ones you
already have. **Read at night in Dullaby** under Discover opens it with the
library and no paper, to bring it up to date.

Papers you **Keep** in Dullaby come back here: its list of kept papers has
**Add to Lightkone**, which opens this app's Add panel with the paper.
