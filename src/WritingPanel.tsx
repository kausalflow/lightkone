import { useMemo, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { candidatesFor, citeCommand, citeKeysIn, papersForKeys, parseVerdicts, type Candidate, type Verdict } from "./core/writing";
import { sourcesPrompt } from "./core/ask";
import { shortAuthors } from "./core/cite";
import { libraryToBibtex } from "./core/bibtex";
import { checkSupport } from "./plugins/claude";

const COMMANDS = ["cite", "citep", "citet", "autocite", "parencite"];
const RANK: Record<Verdict["support"], number> = { supports: 0, related: 1, no: 2 };

function copy(text: string, done: (msg: string) => void) {
  navigator.clipboard?.writeText(text).then(() => done(`Copied ${text.length > 60 ? "the .bib" : text}`), () => done("Could not copy."));
}

/** Find what to cite for a sentence, and make the .bib for a manuscript. */
export function WritingPanel(props: {
  papers: Paper[];
  texts: Map<string, string>;
  settings: Record<string, string>;
  hidden?: boolean;
  onOpen(paperId: string, page: number): void;
  onClose(): void;
}) {
  const [tab, setTab] = useState<"cite" | "bib">("cite");
  return (
    <div class="overlay" hidden={props.hidden} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel wide writing-panel">
        <h2>Writing helpers</h2>
        <div class="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "cite"} class={tab === "cite" ? "on" : ""} onClick={() => setTab("cite")}>Cite this</button>
          <button role="tab" aria-selected={tab === "bib"} class={tab === "bib" ? "on" : ""} onClick={() => setTab("bib")}>.bib for a manuscript</button>
        </div>
        {tab === "cite" ? <CiteThis {...props} /> : <BibForManuscript papers={props.papers} />}
        <div class="row">
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function CiteThis(props: { papers: Paper[]; texts: Map<string, string>; settings: Record<string, string>; onOpen(id: string, page: number): void }) {
  const [sentence, setSentence] = useState("");
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [verdicts, setVerdicts] = useState<Map<string, Verdict> | null>(null);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cmd, setCmd] = useState(() => {
    try {
      return localStorage.getItem("lightkone.cite.command") || "cite";
    } catch {
      return "cite";
    }
  });
  const hasKey = Boolean(props.settings["claude.apiKey"]);

  function find(e: Event) {
    e.preventDefault();
    const c = candidatesFor(props.papers, props.texts, sentence);
    setFound(c);
    setPicked(new Set());
    setVerdicts(null);
    setNote(c.length ? null : "Nothing in your library shares enough words with that sentence.");
  }

  async function check() {
    if (!found?.length) return;
    setChecking(true);
    setNote(null);
    try {
      const sources = found.flatMap((c) => c.passages);
      const byId = new Map(found.map((c) => [c.paper.id, c.paper]));
      const vs = parseVerdicts(await checkSupport(props.settings, sentence, sourcesPrompt(sources, byId)));
      // A paper counts as its best passage.
      const best = new Map<string, Verdict>();
      for (const v of vs) {
        const s = sources.find((x) => x.n === v.n);
        if (!s) continue;
        const had = best.get(s.paperId);
        if (!had || RANK[v.support] < RANK[had.support]) best.set(s.paperId, v);
      }
      setVerdicts(best);
      setFound([...found].sort((a, b) => RANK[best.get(a.paper.id)?.support ?? "no"] - RANK[best.get(b.paper.id)?.support ?? "no"]));
      setPicked(new Set(found.filter((c) => best.get(c.paper.id)?.support === "supports").map((c) => c.paper.key)));
      if (!vs.length) setNote("Claude's reply could not be read. Try again.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setChecking(false);
    }
  }

  function toggle(key: string) {
    const next = new Set(picked);
    next.has(key) ? next.delete(key) : next.add(key);
    setPicked(next);
  }

  function pickCmd(c: string) {
    setCmd(c);
    try {
      localStorage.setItem("lightkone.cite.command", c);
    } catch {
      // private window
    }
  }

  const keys = found?.filter((c) => picked.has(c.paper.key)).map((c) => c.paper.key) ?? [];

  return (
    <>
      <p class="muted">Paste a sentence from your draft. Lightkone finds the papers in your library that match it{hasKey ? ", and Claude can check which ones actually back it" : ""}.</p>
      <form onSubmit={find}>
        <textarea rows={3} value={sentence} autoFocus placeholder="The renormalization group flow has a fixed point at the critical temperature." onInput={(e) => setSentence(e.currentTarget.value)} />
        <div class="row">
          <button class="primary" type="submit" disabled={!sentence.trim()}>Find papers</button>
          {found && found.length > 0 && hasKey && (
            <button type="button" onClick={check} disabled={checking}>{checking ? "Checking…" : "Check with Claude"}</button>
          )}
        </div>
      </form>
      {note && <p class="message" role="status">{note}</p>}
      {found && found.length > 0 && (
        <>
          <ul class="candidates">
            {found.map((c) => {
              const v = verdicts?.get(c.paper.id);
              const s = c.passages[0];
              return (
                <li key={c.paper.id} class={v ? `v-${v.support}` : ""}>
                  <input type="checkbox" checked={picked.has(c.paper.key)} onChange={() => toggle(c.paper.key)} aria-label={`Cite ${c.paper.title}`} />
                  <div>
                    <div class="cand-title">
                      {c.paper.title}
                      {v && <span class={`verdict ${v.support}`}>{{ supports: "backs it", related: "related", no: "doesn't back it" }[v.support]}</span>}
                    </div>
                    <div class="muted small">
                      {[shortAuthors(c.paper.authors), c.paper.year].filter(Boolean).join(" ")} · <code>{c.paper.key}</code>
                    </div>
                    <div class="snippet">
                      <a href="#" class="page" onClick={(e) => { e.preventDefault(); props.onOpen(c.paper.id, s.page); }}>{s.page ? `p. ${s.page}` : "abstract"}</a>{" "}
                      {v?.quote ? `“${v.quote}”` : s.text.length > 240 ? `${s.text.slice(0, 240)}…` : s.text}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div class="row">
            <select value={cmd} onChange={(e) => pickCmd(e.currentTarget.value)} aria-label="Citation command">
              {COMMANDS.map((c) => <option key={c} value={c}>\{c}</option>)}
            </select>
            <code class="cite-out">{keys.length ? citeCommand(keys, cmd) : "Tick the papers to cite"}</code>
            <button class="primary" disabled={!keys.length} onClick={() => copy(citeCommand(keys, cmd), setNote)}>Copy</button>
          </div>
        </>
      )}
    </>
  );
}

function BibForManuscript(props: { papers: Paper[] }) {
  const [tex, setTex] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const keys = useMemo(() => citeKeysIn(tex), [tex]);
  const { found, missing } = useMemo(() => papersForKeys(props.papers, keys), [props.papers, keys]);
  const bib = found.length ? libraryToBibtex(found) : "";

  async function load(file: File | undefined) {
    if (file) setTex(await file.text());
  }

  function save() {
    const url = URL.createObjectURL(new Blob([bib], { type: "application/x-bibtex" }));
    Object.assign(document.createElement("a"), { href: url, download: "references.bib" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <p class="muted">Paste your LaTeX, or open the .tex file. You get a .bib with exactly the papers it cites, in the order it cites them.</p>
      <textarea rows={6} value={tex} placeholder={"As shown in \\cite{Wilson1971,Jumper2021}…"} onInput={(e) => setTex(e.currentTarget.value)} />
      <div class="row">
        <label class="pill file">
          Open .tex file
          <input type="file" accept=".tex,.ltx,.txt,text/x-tex,text/plain" hidden onChange={(e) => load(e.currentTarget.files?.[0])} />
        </label>
        {keys.length > 0 && (
          <span class="muted small">
            {found.length} of {keys.length} cited key{keys.length === 1 ? "" : "s"} found in your library
          </span>
        )}
      </div>
      {missing.length > 0 && (
        <p class="message">
          Not in your library: {missing.map((k, i) => <span key={k}>{i ? ", " : ""}<code>{k}</code></span>)}
        </p>
      )}
      {note && <p class="message" role="status">{note}</p>}
      <div class="row">
        <button class="primary" disabled={!bib} onClick={save}>Download references.bib</button>
        <button disabled={!bib} onClick={() => copy(bib, setNote)}>Copy</button>
      </div>
    </>
  );
}
