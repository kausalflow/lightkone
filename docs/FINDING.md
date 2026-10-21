# Finding papers

## Search

The search box at the top (or **/**) matches words in titles, authors,
abstracts, venues, tags, notes, citation keys, DOIs and arXiv ids. Every word
must match, and title and author matches come first. Filters can be mixed with
words:

| Filter | Finds |
| --- | --- |
| `author:hinton` | Papers with that author |
| `year:2019`, `year:2015-2020` | Papers from that year or range |
| `tag:"machine learning"` | Papers with that tag (quotes for spaces) |
| `in:"Physics/QFT"` | Papers in that folder and the folders inside it |
| `has:pdf`, `has:abstract`, `has:arxiv`, `has:notes` | Papers that have one |
| `no:pdf`, `no:abstract`, `no:arxiv`, `no:notes` | Papers that lack one (`no:pdf`: no PDF in your storage yet) |
| `is:starred`, `is:recent`, `is:trash` | Starred, recently read, or in the trash |

## Inside the PDFs

Once a paper's PDF has been read for search, its words are found too, with
the page they are on. Papers you open are read on their own. For the rest,
the list says how many haven't been read yet and offers **Read them now**.
The text is kept in `lightkone/text/` next to the library, so this happens
once per paper.

## Search by equation

**Search by equation** (side bar, *Discover*) finds the papers in your
library that use a formula. Type it in LaTeX, for example `E = mc^2` or
`\nabla \cdot B = 0`. Lightkone reads the displayed equations from the LaTeX
source that arXiv keeps for each paper, so it covers papers with an arXiv id,
and it finds an equation however it was spaced, braced or named. Reading
the equations of a large library takes a while the first time (arXiv asks to
be read gently). It can be stopped and picked up later.

## Ask your library

**Ask** at the top answers a question from your papers, with a Claude key. It
picks the passages that bear on the question from your papers' full text and
abstracts, and Claude answers citing them as [1], [2]: tap one to open that
paper at that page.

**From**, above the question, chooses which papers it answers from:

- **Your whole library**.
- **In view**: the folder, tag, Starred or search open in the list. Open the
  folder first, then Ask.
- **Papers you pick**: tick them in a list you can filter by title, author or
  year.
- **Published papers beyond your library**: OpenAlex searches all published
  work for the words of your question and Claude answers from the abstracts
  of what it finds, saying that it has only abstracts. Each paper it cites has
  an **Add** button, or says it is already in your library.

## Compare papers

**Compare papers** (side bar, *Discover*) works on the same choice of papers
as Ask: the whole library, what is in view, or papers you pick. It has three
tabs, and each needs a Claude key.

- **Table**: name the columns, for example *Method, Data, Main result, Error
  bars, Assumptions*. Claude reads each paper and fills its row, three papers
  at a time, with the page each value is on: tap **p. 3** to open it there,
  and hover a value for the sentence it is read from. A paper whose PDF has
  not been read for search is read from its abstract, and its row says so.
  Values the paper does not state say *not stated*. Download the table as
  **CSV**, or copy it as a **LaTeX table** citing each paper by its key. Up to
  50 papers at a time; the last table stays until you fill a new one.
- **Agree or disagree**: state a claim. Lightkone finds the passages in the
  chosen papers that bear on it, and Claude sorts them into what **supports**,
  **qualifies** or **contradicts** it, each point linked to its page, with a
  short summary of where and why the papers differ. Papers with nothing on the
  claim are listed apart. Copy the result as Markdown.
- **Review draft**: Claude drafts a literature review of the chosen papers
  from their abstracts and your notes, grouped by theme, in **LaTeX** with
  `\cite{key}` or **Markdown** with `[@key]`, using your citation keys so it
  compiles against your .bib. Say what the review is for to focus it.
  Lightkone flags any key that is not among the chosen papers, and downloads a
  .bib of the papers the draft cites. Read it as a first draft and check every
  claim against the papers. Up to 60 papers.

## New on arXiv

**New on arXiv** ranks each day's preprints, in the categories your library
is in (or the ones you choose), by how close they are to your papers.
Keywords you give lift preprints that mention them. Add the good ones with
one tap.

## The citation map

**Citation map** shows which of your papers cite which, from OpenAlex. Tap a
paper to see what it cites and what cites it. Its *Missing from your library* tab lists the
works several of your papers cite that your library doesn't have yet, most
cited first. A paper's details also offer **Find related** for its
neighbours.

## Organizing

- **Folders** sit in the side bar and can nest (`Physics/QFT`). A paper can be
  in several. Put a paper in a folder from its details.
- **Tags** are listed under the folders. Big imported libraries show the most
  used first.
- **Star** the papers you come back to.
- **Trash**: deleted papers wait there until you restore them or empty it.
- **Tidy up** finds the same paper entered twice (same DOI, arXiv id or title)
  and merges each group into one, keeping every tag, folder and note. It also
  finds arXiv preprints that have since been published and fills in the
  journal, DOI, volume and pages, keeping citation keys.
