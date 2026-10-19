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

## Reading at night

With the Dullaby plugin set up (**Settings → Dullaby night reading**), **Read
at night** opens a paper in Dullaby's calm, dim reading mode.
