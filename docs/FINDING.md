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

## Chats with Claude

Everything you ask Claude happens in **Chats** and is kept there. That covers
questions to your library, chats about one paper, explanations from the
reader, comparison tables, agree-or-disagree weighings and review drafts.
Open it with the chat button at the top or **Ask**. **Ctrl J** (⌘J on a Mac)
starts a chat about the paper you are reading or have selected, from
anywhere, the reader included. A paper's **Chat about it** does the same.

A new chat has four kinds, as tabs: **Ask**, **Table**, **Agree or
disagree** and **Review draft**. Each needs a Claude key.

### Ask

About one paper, Claude reads the whole PDF (or the abstract, without one)
with each question. **Choose other papers** asks more of the library
instead. Then Lightkone picks the passages that bear on the question from
the papers' full text and abstracts, and Claude answers citing them as [1],
[2]: tap one to open that paper at that page.

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

### Compare papers

The other three tabs work on the same choice of papers: the whole library,
what is in view, or papers you pick. Once there is a result, the choice
folds into one line above it, so the result is in view; tap the line to
change it.

- **Table**: name the columns, for example *Method, Data, Main result, Error
  bars, Assumptions*. Claude reads each paper and fills its row, three papers
  at a time, with the page each value is on: tap **p. 3** to open it there,
  and hover a value for the sentence it is read from. On a phone, or in a
  narrow panel, each paper is a card with its values one under another. A
  paper whose PDF has not been read for search is read from its abstract, and
  its row says so. Values the paper does not state say *not stated*. Download
  the table as **CSV**, or copy it as a **LaTeX table** citing each paper by
  its key. Up to 50 papers at a time.
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

### Finding and organizing chats

The list gathers chats **by papers**: each paper, or each set of papers asked
about together, is a group, and so are the whole library and beyond it. The
same set in any order is one group. The **+** on a group starts a new chat
about those papers. The list can gather **by date** or **by topic** instead.
It can be narrowed to one kind, or one topic, and searched by words in a
chat's name, question, answer or topics.

Open a chat to read it again with its citations linked, and carry on where it
stopped. Above it:

- the pencil **renames** it (or double-click the title);
- the pin keeps it at the top of the list, under **Pinned**;
- **+ Topic** labels it, for example *RG flow* or *thesis ch. 3*, so chats on
  one subject gather together whatever papers they were about;
- copy it as **Markdown** for your notes, with its citations named, or
  delete it on every device;
- **Table of these papers**, **Where they agree** and **Ask about these**
  take its papers on to a new chat of another kind.

A paper's details list its **chats about this paper**. A Summarize result
there has **Follow up in Chats**. An Ask answer that cites several papers
offers to compare them in a table.

On a wide screen, the chat button's panel shows the list and the open chat
side by side. It can be snapped to the right or the bottom edge with the
buttons in its top corner. It then stays open beside the list and the reader,
so a long chat or a table can be worked on while you read. Drag its inner edge
to resize it; the size and the place are remembered. The window button puts
it back over the app. On a phone it opens as a sheet.

Chats live in your own storage, at `lightkone/history/`, one file per chat,
so they follow you across devices. In a shared library, or one you can only
read, your chats stay in this browser instead, so the group never sees your
questions.

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
