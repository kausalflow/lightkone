# Papers on an e-reader

Lightkone can put a paper on a small e-ink reader (the Xteink X4 and X4 Pro, a
Kobo, a Kindle, anything running KOReader) in a form that reads well on a
4-inch screen. A whole PDF page shrunk to that size is unreadable, so instead
the paper becomes an **EPUB**:

- The text reflows to the screen, at whatever font size you pick on the reader.
- Math in sentences is written out as text, so it stays in the sentence:
  *s*<sub>*t*</sub>, (*X*<sub>*t*</sub>, *S*<sub>*t*</sub>), θ ∈ ℝ, *a*/(*b* + 1).
  Small readers can't typeset math, and many put every picture on a line of its
  own, which would break the sentence apart. Only formulas too complex for text
  (matrices, long expressions) become pictures.
- Each displayed equation is a sharp black picture, sized to the reader's text
  and with its strokes thickened so they survive the e-ink screen.
- Numbered equations keep their numbers. Figures are fetched and scaled down to
  the screen's width, footnotes appear in brackets where they are, and each
  section is a chapter in the reader's table of contents.

The text comes from the paper's HTML version: arXiv's own, or for older
preprints [ar5iv](https://ar5iv.labs.arxiv.org)'s, which has nearly every arXiv
paper. Saved web pages work too.

## Papers that only have a PDF

Small readers such as the X4 can't open PDFs, and a whole page shrunk to a
4-inch screen is unreadable. So when a paper has no HTML version, Lightkone
takes its PDF (the copy in your library, or arXiv's) and **re-flows** it:

- Each page is drawn, cut into its columns, lines and words, and the words are
  laid out again in lines that fit the screen, at a readable size. Two-column
  papers are read down the left column, then the right.
- The paper keeps its own typesetting: fonts, symbols and inline math look as
  they do in the PDF.
- Figures, tables and displayed equations are kept whole, shrunk to the
  screen's width when wider.
- Words split by a hyphen at a line's end are joined again; page numbers and
  arXiv's sideways stamp are left out.

The book is one picture per screen, so the reader's font size setting doesn't
change it: set **PDF text size** (`small`, `medium`, `large`) under Settings →
Plugins → Send to e-reader instead. To use the PDF even when there is an HTML
version, set **Make it from** to `pdf`.

A 30-page paper takes about a minute to make and is around 6 MB.

## Sending a paper

Open a paper and choose one of:

- **Send to e-reader** makes the EPUB, keeps it in your library's storage under
  `lightkone/ereader/`, and adds it to your **e-reader catalog**. The reader
  downloads it from there over Wi-Fi.
- **Download for e-reader** makes the same EPUB and saves it to your device.
  Load it with the reader's own app (in the Xteink app: **Import**), over USB,
  or from its SD card.

Making the file happens in your browser and takes a few seconds; a paper with
many figures takes longer.

## The e-reader catalog

The catalog is an [OPDS](https://opds.io) feed, the standard way e-readers
browse and download books from a server. It lists the papers you sent, newest
first.

1. In Lightkone, open **Settings → E-reader** and press **Make my e-reader
   catalog address**. Copy the address.
2. On the reader, open the OPDS catalogs screen. On the Xteink X4 and X4 Pro
   it is **Settings → Third-party services → OPDS catalogs** (update the
   reader's system if it isn't there). In KOReader it is **Search → OPDS
   catalog**.
3. Add a catalog named Lightkone with that address. Leave the user name and
   password empty.
4. Open the catalog and download a paper.

The catalog needs your library in an S3/R2 bucket or a GitHub repository (see
[Storage](STORAGE.md)): a library kept only in a browser can't be reached from
the reader. **Download for e-reader** works with any library.

The address is kept in your library (`lightkone/links.json`), so Settings →
E-reader shows the same one again later and on your other devices. **Make a
new address** replaces it; the old one keeps working until you replace the
storage key inside it.

**Remove** a paper from the catalog under Settings → E-reader.

### What the address can do

Like the AI app address ([MCP](MCP.md)), the catalog address carries your
storage settings, encrypted with a key only the site has, and the site keeps no
copy. Unlike it, the catalog address can only list the papers you sent to the
reader and download them: it can't read the rest of your library or change
anything. Anyone who has it can download those papers. To cut it off, replace
the storage access key or token.

## Adjusting the math

Under Settings → Plugins → Send to e-reader:

- **Math in sentences**: `text` (the default) as above; `plain` writes s_t,
  x^2 and theta in R, for readers whose font shows boxes for Greek letters or
  that ignore raised and lowered letters; `pictures` makes a picture of each
  formula, as before.
- **Equation size**: `small`, `medium` (the default, matching the Xteink X4's
  normal font) or `large` for a big reading font.

Send the paper again after changing these.

## If equations don't show

Equations are PNG pictures in shades of grey. If your reader shows the text but
no equations, open Settings → Plugins → Send to e-reader, set **Picture
format** to `jpeg`, and send the paper again.

## For hosts

The catalog uses the same `MCP_SECRET` as personal AI app addresses (see
[MCP](MCP.md#for-whoever-hosts-the-site)).

The catalog address is long, which is awkward to type on a reader's on-screen
keyboard. To give everyone short addresses such as
`https://<site>/opds/k7fq3m9xra`, add a KV namespace to the Pages project:

- In the Cloudflare dashboard, **Storage & Databases → KV → Create** a
  namespace, named for example `lightkone-links`.
- In the Pages project, **Settings → Bindings → Add → KV namespace**: variable
  name `LINKS`, that namespace. Add it for Production and Preview.

LINKS holds only random codes and the encrypted addresses they stand for.
