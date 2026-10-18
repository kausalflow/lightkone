import { useEffect, useState } from "preact/hooks";

export type InfoPage = "how" | "data" | "keys";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

/** Background pages: how Lightkone works, what is processed where, and its keys. */
export function InfoPanel(props: { page: InfoPage; onClose(): void }) {
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
        <h2>About Lightkone</h2>
        <div class="tabs" role="tablist">
          {(
            [
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
        {page === "how" && <How />}
        {page === "data" && <Data />}
        {page === "keys" && <Keys />}
        <div class="row">
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
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
