import { useState } from "preact/hooks";
import type { BibTarget, Paper } from "./core/types";
import type { ManuscriptReport } from "./core/manuscript";
import { targetId } from "./core/bibsync";
import { shortAuthors } from "./core/cite";

/** Manuscripts in GitHub whose .bib is kept exactly in step with what they cite. */
export function ManuscriptPanel(props: {
  manuscripts: BibTarget[];
  reports: Map<string, ManuscriptReport>;
  papers: Paper[];
  hasToken: boolean;
  defaultRepo: string;
  checking: boolean;
  hidden?: boolean;
  onSave(manuscripts: BibTarget[]): void;
  onCheck(): void;
  onSettings(): void;
  onClose(): void;
}) {
  const [adding, setAdding] = useState(!props.manuscripts.length);
  const set = (i: number, t: BibTarget | null) => props.onSave(props.manuscripts.flatMap((m, j) => (j === i ? (t ? [t] : []) : [m])));

  return (
    <div class="overlay" hidden={props.hidden} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel wide manuscript-panel">
        <h2>Watch my manuscript</h2>
        <p class="muted">
          Lightkone reads the .tex files of a paper in a GitHub repository (Overleaf can sync there: Menu → GitHub) and keeps its .bib holding exactly what
          the paper cites. It checks after every change to your library, when you come back to Lightkone, and when you ask.
        </p>
        {!props.hasToken && (
          <p class="message">
            First add a GitHub token with Contents read and write on the repository, under{" "}
            <button type="button" class="link" onClick={props.onSettings}>Settings → BibTeX sync to GitHub</button>.
          </p>
        )}
        {props.manuscripts.map((m, i) => (
          <Watched key={targetId(m)} target={m} report={props.reports.get(targetId(m))} papers={props.papers} onChange={(t) => set(i, t)} />
        ))}
        {adding ? (
          <AddManuscript
            defaultRepo={props.defaultRepo}
            onAdd={(t) => {
              setAdding(false);
              props.onSave([...props.manuscripts.filter((m) => targetId(m) !== targetId(t)), t]);
            }}
            onCancel={props.manuscripts.length ? () => setAdding(false) : undefined}
          />
        ) : (
          <div class="row left">
            <button onClick={() => setAdding(true)}>Watch another manuscript</button>
          </div>
        )}
        <div class="row">
          {props.manuscripts.length > 0 && (
            <button class="primary" disabled={props.checking || !props.hasToken} onClick={props.onCheck}>
              {props.checking ? "Checking…" : "Check now"}
            </button>
          )}
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Watched(props: { target: BibTarget; report?: ManuscriptReport; papers: Paper[]; onChange(t: BibTarget | null): void }) {
  const t = props.target;
  const r = props.report;
  const where = `${t.repo}${t.tex ? `/${t.tex}` : ""}`;
  const bibName = t.path.split("/").pop()!.replace(/\.bib$/i, "");
  return (
    <section class="manuscript">
      <h3>{where}{t.branch ? ` (${t.branch})` : ""}</h3>
      <p class="small muted">
        .bib: <code>{t.path}</code>. Use <code>{`\\bibliography{${bibName}}`}</code> or <code>{`\\addbibresource{${bibName}.bib}`}</code>.
      </p>
      {!r && <p class="small muted">Not checked yet.</p>}
      {r && !r.texFiles.length && <p class="small error">No .tex files found there.</p>}
      {r && r.texFiles.length > 0 && (
        <p class="small">
          {r.keys.length} cited in {r.texFiles.length} .tex file{r.texFiles.length === 1 ? "" : "s"}; {r.inBib} in the .bib
          {r.kept.length ? `, ${r.kept.length} kept as written there (${r.kept.join(", ")})` : ""}.
          {r.missing.length === 0 && r.keys.length > 0 && " Everything it cites is in the .bib."}
        </p>
      )}
      {r && r.missing.length > 0 && (
        <>
          <p class="small"><strong>Cited but not in your library:</strong> add these papers and the .bib follows, or say which paper a key means.</p>
          <ul class="missing-keys">
            {r.missing.map((m) => (
              <li key={m.key}>
                <code>{m.key}</code>
                {m.maybe.map((p) => (
                  <button key={p.id} class="small" title={p.title} onClick={() => props.onChange({ ...t, aliases: { ...t.aliases, [m.key]: p.id } })}>
                    It's {shortAuthors(p.authors)} {p.year}: {p.title.length > 50 ? `${p.title.slice(0, 50)}…` : p.title}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {t.aliases && Object.keys(t.aliases).length > 0 && (
        <p class="small muted">
          Matched by hand:{" "}
          {Object.entries(t.aliases).map(([k, id], i) => (
            <span key={k}>
              {i > 0 && ", "}
              <code>{k}</code> → {props.papers.find((p) => p.id === id)?.key ?? "a removed paper"}{" "}
              <a href="#" onClick={(e) => {
                e.preventDefault();
                const { [k]: _, ...rest } = t.aliases!;
                props.onChange({ ...t, aliases: Object.keys(rest).length ? rest : undefined });
              }}>undo</a>
            </span>
          ))}
        </p>
      )}
      <button class="link danger small" onClick={() => props.onChange(null)}>Stop watching</button>
    </section>
  );
}

function AddManuscript(props: { defaultRepo: string; onAdd(t: BibTarget): void; onCancel?: () => void }) {
  const [repo, setRepo] = useState(props.defaultRepo);
  const [tex, setTex] = useState("");
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const dir = tex.trim().replace(/^\/+|\/+$/g, "");
  const bib = (path.trim() || `${dir ? `${dir}/` : ""}references.bib`).replace(/^\/+/, "");
  const valid = /^[\w.-]+\/[\w.-]+$/.test(repo.trim()) && /\.bib$/i.test(bib);
  return (
    <form
      class="manuscript-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) props.onAdd({ folder: "", repo: repo.trim(), path: bib, tex: dir, ...(branch.trim() ? { branch: branch.trim() } : {}) });
      }}
    >
      <label class="field">
        <span>Repository</span>
        <input value={repo} placeholder="owner/my-paper" onInput={(e) => setRepo(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span>Folder with the .tex files (optional)</span>
        <input value={tex} placeholder="the top of the repository" onInput={(e) => setTex(e.currentTarget.value)} />
      </label>
      <label class="field">
        <span>.bib file</span>
        <input value={path} placeholder={bib} onInput={(e) => setPath(e.currentTarget.value)} />
        <span class="muted small">An existing .bib is fine: entries for keys your library doesn't have are kept as they are.</span>
      </label>
      <label class="field">
        <span>Branch (optional)</span>
        <input value={branch} placeholder="main" onInput={(e) => setBranch(e.currentTarget.value)} />
      </label>
      <div class="row left">
        <button class="primary" type="submit" disabled={!valid}>Watch</button>
        {props.onCancel && <button type="button" onClick={props.onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
