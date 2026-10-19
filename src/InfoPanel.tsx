import { useEffect, useState } from "preact/hooks";

export type InfoPage = "start" | "guide" | "how" | "data" | "keys";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** Help, open at any time: a start, a guide to each task, how it works, what is processed where, and the keys. */
export function InfoPanel(props: { page: InfoPage; onTour(): void; onClose(): void }) {
  const [page, setPage] = useState<InfoPage>(props.page);
  useEffect(() => setPage(props.page), [props.page]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, []);
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel wide info-panel">
        <h2>Help</h2>
        <div class="tabs" role="tablist">
          {(
            [
              ["start", "Start here"],
              ["guide", "Guide"],
              ["how", "How it works"],
              ["data", "Your data"],
              ["keys", "Shortcuts"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={page === id} class={page === id ? "on" : ""} onClick={() => setPage(id)}>
              {label}
            </button>
          ))}
        </div>
        {page === "start" && <Start onTour={props.onTour} />}
        {page === "guide" && <Guide />}
        {page === "how" && <How />}
        {page === "data" && <Data />}
        {page === "keys" && <Keys />}
        <div class="row">
          <a class="button" href="docs/" target="_blank" rel="noopener">
            Full documentation
          </a>
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Start(props: { onTour(): void }) {
  return (
    <div class="info-body">
      <p>
        Lightkone keeps your papers, their PDFs, your highlights and notes in one library you can search, read and cite from. It runs in this
        browser; the library lives in storage you choose.
      </p>
      <h3>First steps</h3>
      <ol>
        <li>
          <strong>Add a paper</strong> with the + button: a DOI, an arXiv id, a link or a title. A free PDF is fetched when there is one.
        </li>
        <li>
          <strong>Bring your library</strong>: in the same place, import a .bib exported from Paperpile, Zotero or Mendeley.
        </li>
        <li>
          <strong>Read</strong>: open a paper and press Read. Select text to highlight it or add a note.
        </li>
        <li>
          <strong>Pick where it lives</strong>: in Settings, move from this browser to an S3 or R2 bucket or a private GitHub repository, so
          every device sees the same library.
        </li>
        <li>
          <strong>Add a Claude key</strong> in Settings, if you want Ask, Explain and the check in Cite this. It stays in this browser.
        </li>
      </ol>
      <p class="muted small">
        A new library starts with two example papers, tagged Example, to try things on. Move them to the trash whenever you like; they won't come back.
      </p>
      <p>
        Coming from Paperpile? <a href="docs/paperpile.html" target="_blank" rel="noopener">Moving from Paperpile</a> brings your library,
        folders, labels and PDFs over, step by step for each kind of storage.
      </p>
      <div class="row">
        <button onClick={props.onTour}>Show the welcome tour again</button>
      </div>
    </div>
  );
}

function Guide() {
  const sections: [string, preact.ComponentChildren[]][] = [
    [
      "Adding papers",
      [
        "Add paper takes several DOIs, arXiv ids, links or BibTeX entries at once, one per line. With a Claude key, a plain description works too.",
        "Import a .bib to bring a whole library. Papers already there are matched, not doubled.",
        "On a phone, install Lightkone from the browser menu and share any paper's page to it. On a computer, use the + Lightkone bookmark from the Add panel.",
      ],
    ],
    [
      "Reading and highlighting",
      [
        "Read opens the PDF. Select text, then Highlight, Note, or Explain (with a Claude key).",
        "No PDF yet? Get free PDF looks for an open copy, or Attach PDF adds your own file.",
        "Highlights are kept beside the paper and go out with Export to Obsidian.",
      ],
    ],
    [
      "Finding",
      [
        <>
          The search box understands <code>author:hinton</code>, <code>year:2015-2020</code>, <code>tag:"machine learning"</code>,{" "}
          <code>in:"Physics/QFT"</code>, <code>has:pdf</code>, <code>is:starred</code> and <code>is:recent</code>.
        </>,
        "Once PDFs have been read for search, the words inside papers are found too, with the page they are on.",
        "Search by equation finds arXiv papers in your library that use a formula. Ask answers a question from your papers, citing the pages.",
      ],
    ],
    [
      "Organizing",
      [
        "Folders and tags sit in the side bar; a paper can be in several folders. Star the ones you come back to.",
        "Tidy up finds duplicates and preprints that have since been published.",
        "Deleted papers wait in the Trash until you empty it.",
      ],
    ],
    [
      "Writing",
      [
        "Cite, on a paper, copies it as APA, Markdown, \\cite or BibTeX.",
        "Writing helpers suggest what to cite for a sentence and build a .bib from a .tex file.",
        "Sync .bib keeps a folder's .bib in a GitHub repository for Overleaf; Watch my manuscript keeps it to what the manuscript cites.",
      ],
    ],
    [
      "Discovering",
      [
        "New on arXiv ranks each day's preprints in the categories you follow by how close they are to your library.",
        "The citation map shows which of your papers cite which, and what they cite that you don't have yet. Find related, on a paper, lists its neighbours.",
      ],
    ],
    [
      "Devices, sharing and AI apps",
      [
        "Settings decides where the library lives. A library kept only in this browser is lost if the browser's site data is cleared, so move it to a bucket or GitHub once it matters.",
        "Shared libraries are a bucket or repository a group can reach; send an invite link from that panel. Keys never travel in it.",
        "Settings also makes a private address that lets Claude and other AI apps (MCP) read and add to your library.",
      ],
    ],
  ];
  return (
    <div class="info-body">
      {sections.map(([title, items]) => (
        <details key={title} class="guide">
          <summary>{title}</summary>
          <ul>
            {items.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

function How() {
  return (
    <div class="info-body">
      <p>
        Lightkone is a web app that runs in your browser. There is no Lightkone account and no Lightkone database: your library is a few files in
        storage you choose, and this site only serves the app.
      </p>
      <h3>Where the library lives</h3>
      <ul>
        <li>
          <strong>In storage you pick in Settings:</strong> this browser, an S3, R2 or MinIO bucket, or a private GitHub repository.
        </li>
        <li>
          <code>lightkone/library.json</code> holds the papers, folders, tags and notes; <code>papers/All Papers/…</code> holds the PDFs, in
          Paperpile's layout; highlights sit next to each paper.
        </li>
        <li>Everything is in open formats (JSON and BibTeX), so you can read it, back it up or leave with it.</li>
      </ul>
      <h3>Where the work happens</h3>
      <ul>
        <li>
          <strong>In your browser:</strong> search, full-text search, ranking New on arXiv, matching equations, drawing the citation map, picking
          passages for Ask, reading PDFs, and merging your changes with those made on another device.
        </li>
        <li>
          <strong>Saved so it isn't redone:</strong> what was fetched or worked out once is kept beside the library (<code>lightkone/citations.json</code>,{" "}
          <code>equations.json</code>, <code>new-on-arxiv.json</code>, <code>text/</code>), and only new or changed papers are processed again.
        </li>
        <li>
          <strong>On this site's small server functions</strong>, only where a browser is not allowed to call a service directly: reading arXiv
          listings and LaTeX sources, finding open-access PDFs, checking which preprints were published, and the address for AI apps (MCP). They
          keep nothing; public answers from arXiv are cached for a while.
        </li>
      </ul>
      <h3>Saving</h3>
      <p>
        Each change is saved to your storage a moment after you make it. If another device or Claude changed the library meanwhile, the two are
        merged rather than one overwriting the other.
      </p>
    </div>
  );
}

function Data() {
  const rows: [string, string][] = [
    ["Your papers, notes, highlights and PDFs", "Only your own storage. This site never receives them, except when you use the AI app address (MCP): then its server reads your library from your storage for each request, with your storage keys sealed inside your private address."],
    ["Keys and tokens (Claude, GitHub, bucket, OpenAlex)", "Only this browser's settings. Each is sent only to the service it belongs to. Invite links for shared libraries never carry them."],
    ["Ask, Explain and the check in Cite this", "When you use them, your question and the passages picked from your papers go from your browser straight to Anthropic, with your own Claude key."],
    ["Adding and looking up papers", "The DOI, arXiv id or title goes to Crossref, OpenAlex, Semantic Scholar or arXiv. For open-access PDFs, the DOI and your contact email go to Unpaywall through this site."],
    ["Related papers and the citation map", "The DOIs or arXiv ids of your papers go to OpenAlex or Semantic Scholar."],
    ["New on arXiv", "Only the categories you follow go to arXiv, through this site. The ranking against your library happens in your browser."],
    ["Search by equation", "Each arXiv id goes to this site, which downloads that paper's public LaTeX source from arXiv and returns its equations."],
    ["Shared libraries", "Who can read and write is decided where the library lives (the repository's collaborators, or the bucket's keys). Papers you add there show your name, if you set one."],
  ];
  return (
    <div class="info-body">
      <p>What is processed where, and what leaves your browser.</p>
      <dl class="info-table">
        {rows.map(([what, where]) => (
          <div key={what}>
            <dt>{what}</dt>
            <dd>{where}</dd>
          </div>
        ))}
      </dl>
      <p class="muted small">
        Lightkone has no analytics, ads or tracking. The site's host (Cloudflare) keeps its usual request logs for the server functions.
      </p>
    </div>
  );
}

function Keys() {
  const keys: [string, string][] = [
    [`${MOD} K`, "Find any tool, view, folder, tag or paper"],
    ["/", "Search the library"],
    ["j  k", "Next and previous paper"],
    ["?", "Open Help"],
    ["Esc", "Close the paper, a panel or the reader"],
    ["↑  ↓  Enter", "Move and open, in the command list"],
  ];
  return (
    <div class="info-body">
      <dl class="info-keys">
        {keys.map(([k, what]) => (
          <div key={k}>
            <dt>
              {k.split("  ").map((x) => (
                <kbd key={x}>{x}</kbd>
              ))}
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <p class="muted small">On a phone, the ⌘ button at the top opens the same command list.</p>
    </div>
  );
}
