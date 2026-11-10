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

**Name a paper with [[.** In any chat, type `[[` and a few letters of a
title, author, year or citation key, then pick the paper (arrows and Enter,
or tap). It goes in as `[[key]]`, as in Obsidian, and shows as the paper's
short name. A paper named this way is always read for that question: its
passages that bear on the question, or its title and abstract when none do.
In a chat about one paper, this brings other papers in beside it, and the
chat is then listed under that set of papers.

**Which papers.** Above the question, a chat starts with one paper: the one
open, or the one you opened last. Add more one at a time: type a few letters
of a title, author, year or key in **Add a paper** and pick it. Tap the × on
a paper to take it out. There is no "whole library" and no "select all":
Claude reads every paper you add with your own API key, so you choose what
it costs.

**Whole PDFs for a few papers.** When the papers you add are five or
fewer and all have their PDF in Lightkone, **Read the whole PDFs** (on by
default) sends the PDFs themselves to Claude instead of passages, so the
answer can use figures, tables and equations as well as the text. Claude's
citations say which page each point comes from; they show as [1], [2] and
open the paper at that page with the quoted passage highlighted. The first question pays for
the PDFs; follow-ups within a few minutes reuse them from Anthropic's cache.
A paper named with `[[` later in the chat is added as its PDF while there is
room for five, then as its title and abstract. Untick the box to ask from
passages, which costs less. When the PDFs are too big for one request
(about 22 MB together, or more than 600 pages), Ask says so and hands the
question back to ask from passages.

Instead of your papers, **Published papers beyond your library** has
OpenAlex search all published work for the words of your question, and
Claude answers from the abstracts of what it finds, saying that it has only
abstracts. Each paper it cites has an **Add** button, or says it is already
in your library.

### Compare papers

The other three tabs work on papers chosen the same way, one at a time,
starting from one. A table takes up to 50 and a review draft up to 60. Once
there is a result, the choice folds into one line above it, so the result is in view; tap the line to
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

### Claude's answers are kept and reused

Every answer Claude gives (a summary, an explanation, an answer in Ask or a
paper chat, a row of a comparison table, a weighing, a review draft, the
checks in Cite this and Cite my draft, the sorting in How others cite this)
is kept in your storage, in `lightkone/answers/`, under a fingerprint of
exactly what was sent: the model, the instructions, the question, and the
passages or PDF. Ask for the same thing again, on any device, and the saved
answer shows at once with a note saying when it was given; Claude is not
asked, so it costs nothing. Anything that changes the request (a new PDF,
other passages found, another model, other columns) asks Claude afresh.
**Summarize again**, **Explain again**, **Ask again**, **Fill again**,
**Weigh again** or **Write again** under a saved answer asks Claude anew and
keeps the new answer in its place. In a shared or read-only library, answers
are kept in this browser only, like your chats.

## New on arXiv

**New on arXiv** ranks each day's preprints, in the categories your library
is in (or the ones you choose), by how close they are to your papers.
Keywords you give lift preprints that mention them. Add the good ones with
one tap.

## The citation map

**Citation map** shows which of your papers cite which, from OpenAlex. Tap a
paper to see what it cites and what cites it. Two layouts:

- **By folder**: one band per folder (or tag), across by year, higher the more
  a paper is cited.
- **Year × citations**: every paper on one plane, across by year and up by
  citations on a log scale; bigger dots have more links inside your library.

The download button saves the map as an SVG picture, styled as you see it, for
slides, a thesis or a web page.

### Explore

**Explore** walks out from one or more *seed* papers through the citation
network. Start it from a paper's details (**Explore around this**), from a paper
on the map (**Explore from this**), from a work on the *Missing* tab, or by
typing a paper's name into the seeds box. It reads

- the works that cite the seeds (the 200 most cited),
- the works the seeds cite, and
- for each, how many references it shares with the seeds and how many of your
  own papers it cites or is cited by,

and ranks them by how closely they tie to the seeds, not by fame alone. Each
says why it is there ("cites 2 of the 3 seeds · shares 14 references · linked
to 4 of your papers"). The picture places seeds, papers you have (filled) and
papers you don't (hollow) by year and citations, linked where one cites another.
Filter by words or years, order by ties, citations or date, hide the ones you
have, **Add** one to your library, or **+ Seed** to widen the walk.

**Keep this exploration** saves it, with every work shown so far. Opening it
again reads the network afresh and marks what is **new** since last time, so a
kept exploration doubles as a watch on a topic.

### Missing from your library

The *Missing* tab lists the works several of your papers cite that your
library doesn't have yet, most cited first. A paper's details also offer
**Find related** for its neighbours by similarity.

## How others cite this

**How others cite this**, in a paper's details, shows the sentences in later
papers that cite it, from Semantic Scholar's citation contexts. It reads the
newest thousand citing papers, puts those that come with their sentences first,
and among them the ones Semantic Scholar marks as influential and the most
cited. Filters pick out those Semantic Scholar tags as citing it for a result,
a method or background, and those already in your library; any other can be
added in one tap.

With a Claude key, **Sort with Claude** reads sixty at a time and marks each
as *supporting* (confirms it, reproduces it, builds on it), *contrasting*
(disputes it, finds a different value, points out a limitation) or
*mentioning*, with a few words on what the citing paper does with it.
Contrasting ones come first. Claude judges from the citing sentence alone,
so open the paper before leaning on a verdict. The sorting is kept in your
storage (`lightkone/citedby/`), so it shows again the next time, on any
device, and only citations that arrived since are left to sort.

Semantic Scholar limits anonymous use; a free key under **Settings → Related
papers** makes it steadier.

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
- **Paper health** marks a paper that has been retracted, corrected (an
  erratum or corrigendum), given an expression of concern, or withdrawn on
  arXiv. The notices come from Crossref, which carries both publishers'
  notices and the Retraction Watch database, and from arXiv. For a preprint
  with a published version, the published version is checked too. A badge
  shows in the list, and the paper's details say what the notice is, when it
  appeared and who reported it, with a link to it. Lightkone checks the
  papers not checked for a month a little after the library opens (switch it
  off in Settings → Paper health), and **Tidy up** lists every paper with a
  notice and can check the whole library at once.
