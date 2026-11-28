import { useEffect, useMemo, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { ISSUES, choicesFor, mergeInto, pickKeeper, scanLibrary, type Choosable, type Issue, type IssueKind, type Picks, type Scan } from "./core/tidy";
import { Icon } from "./icons";

// Library health's scan: one button looks over every paper for duplicates
// (sure and likely), entries with nothing to open, files gone from storage,
// missing or odd details and clashing citation keys. Duplicates merge in a
// dialog where the person picks the copy to keep and, where copies disagree,
// whose title, authors, year and so on win. A merge can be undone.

/** Undoes a merge; resolves when done. */
export type Undo = () => Promise<void>;

const ORDER: IssueKind[] = ["missing-file", "no-source", "key-clash", "no-title", "no-authors", "no-year", "odd-year", "bad-doi", "bad-arxiv"];

const FIELD_LABEL: Record<Choosable, string> = {
  title: "Title",
  authors: "Authors",
  year: "Year",
  venue: "Journal or venue",
  type: "Entry type",
  doi: "DOI",
  arxiv: "arXiv id",
  url: "Link",
  abstract: "Abstract",
  key: "Citation key",
};

const authorsText = (a?: string[]) => {
  const names = (a ?? []).map((x) => x.split(",")[0].trim()).filter(Boolean);
  return names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
};

const meta = (p: Paper) =>
  [authorsText(p.authors), p.year, p.venue, p.pdf ? "PDF" : "", p.attachments?.length ? `${p.attachments.length} more file${p.attachments.length > 1 ? "s" : ""}` : "", p.notes?.trim() ? "notes" : ""]
    .filter(Boolean)
    .join(" · ");

const added = (p: Paper) => new Date(p.added).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function showValue(field: Choosable, v: unknown): string {
  if (field === "authors") {
    // In full here: copies often differ only in first names or initials.
    const a = (v as string[]).filter(Boolean);
    return a.length > 6 ? `${a.slice(0, 6).join("; ")}; and ${a.length - 6} more` : a.join("; ") || "—";
  }
  const s = String(v);
  return field === "abstract" && s.length > 220 ? `${s.slice(0, 220)}…` : s;
}

/** The last scan, so closing the page to open a paper and coming back keeps the results. */
let last: { files: Set<string> | null; error: string | null } | null = null;

export function LibraryScan(props: {
  papers: Paper[];
  version: number;
  readOnly: boolean;
  /** What storage holds, to find files gone missing; null when it can't be listed. */
  listFiles(): Promise<Set<string> | null>;
  onMerge(keep: Paper, others: Paper[], picks: Picks): Promise<Undo>;
  onMergeAll(groups: Paper[][]): Promise<Undo>;
  onDistinct(group: Paper[]): Undo;
  onForgetFile(paper: Paper, path: string): void;
  onOpen(paperId: string): void;
}) {
  const [scan, setScan] = useState<Scan | null>(() => (last ? scanLibrary(props.papers, last.files) : null));
  const [files, setFiles] = useState<Set<string> | null>(last?.files ?? null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(last?.error ?? null);
  const [merging, setMerging] = useState<Paper[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<{ text: string; run: Undo } | null>(null);

  // A merge or edit changes the library: look again, with the files already listed.
  useEffect(() => {
    if (scan) setScan(scanLibrary(props.papers, files));
  }, [props.version]);

  async function run() {
    setScanning(true);
    setError(null);
    let listed: Set<string> | null = null;
    let failed: string | null = null;
    try {
      listed = await props.listFiles();
    } catch (e) {
      failed = `Could not list the files in storage, so missing files were not checked: ${(e as Error).message}`;
    }
    setError(failed);
    last = { files: listed, error: failed };
    setFiles(listed);
    setScan(scanLibrary(props.papers, listed));
    setScanning(false);
  }

  function done(text: string, u: Undo) {
    setUndo({ text, run: u });
  }

  async function doUndo() {
    if (!undo) return;
    setBusy(true);
    try {
      await undo.run();
    } catch (e) {
      setError(`Could not undo: ${(e as Error).message}`);
    }
    setUndo(null);
    setBusy(false);
  }

  const byKind = useMemo(() => {
    const m = new Map<IssueKind, Issue[]>();
    for (const i of scan?.issues ?? []) m.set(i.kind, [...(m.get(i.kind) ?? []), i]);
    return m;
  }, [scan]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (el instanceof HTMLDetailsElement) el.open = true;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const total = scan ? scan.duplicates.length + scan.likely.length + scan.issues.length : 0;

  return (
    <div class="scan">
      <p class="muted small">
        Looks over every paper for duplicates, entries with no link and no PDF, files missing from storage, missing titles, authors or years, odd DOIs or
        arXiv ids, and citation keys used twice. Nothing changes until you choose to.
      </p>
      <div class="row">
        <button class="primary" disabled={scanning} onClick={run}>
          <Icon name="search" size={15} /> {scanning ? "Scanning…" : scan ? "Scan again" : "Scan library"}
        </button>
        {scan && (
          <span class="muted small">
            {scan.papers} papers · {new Date(scan.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
            {!scan.filesChecked && " · files not checked"}
          </span>
        )}
      </div>
      {error && <p class="message">{error}</p>}
      {undo && (
        <p class="message undo-bar">
          <span>{undo.text}</span>
          <button class="small" disabled={busy} onClick={doUndo}>{busy ? "Undoing…" : "Undo"}</button>
        </p>
      )}

      {scan && (
        <>
          {total === 0 ? (
            <p class="message">
              <Icon name="check" size={15} /> Nothing to look at. Every paper has a way to open it{scan.filesChecked ? ", every file is in storage" : ""} and no
              two are the same.
            </p>
          ) : (
            <div class="issue-chips">
              {scan.duplicates.length > 0 && (
                <button class="issue-chip strong" onClick={() => jump("scan-dupes")}>
                  <b>{scan.duplicates.length}</b> duplicate{scan.duplicates.length > 1 ? "s" : ""}
                </button>
              )}
              {scan.likely.length > 0 && (
                <button class="issue-chip" onClick={() => jump("scan-likely")}>
                  <b>{scan.likely.length}</b> possible duplicate{scan.likely.length > 1 ? "s" : ""}
                </button>
              )}
              {ORDER.filter((k) => byKind.has(k)).map((k) => (
                <button key={k} class="issue-chip" onClick={() => jump(`scan-${k}`)}>
                  <b>{byKind.get(k)!.length}</b> {ISSUES[k].short}
                </button>
              ))}
            </div>
          )}

          {scan.duplicates.length > 0 && (
            <section id="scan-dupes" class="scan-section">
              <h4>Duplicates</h4>
              <p class="muted small">
                The same DOI, arXiv id or title. Merging keeps one copy and brings over the others' tags, folders, notes, star, files and missing details; their
                citation keys stay on as aliases, and the other copies go to the trash, marked as merged.
              </p>
              {!props.readOnly && (
                <button
                  class="small"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const n = scan.duplicates.length;
                    const u = await props.onMergeAll(scan.duplicates);
                    setBusy(false);
                    done(`Merged ${n} duplicate${n > 1 ? "s" : ""}.`, u);
                  }}
                >
                  Merge all {scan.duplicates.length}, keeping the suggested copy
                </button>
              )}
              <Groups groups={scan.duplicates} readOnly={props.readOnly} onMerge={setMerging} onDistinct={(g) => done("Marked as not the same.", props.onDistinct(g))} onOpen={props.onOpen} />
            </section>
          )}

          {scan.likely.length > 0 && (
            <section id="scan-likely" class="scan-section">
              <h4>Possible duplicates</h4>
              <p class="muted small">Same first author and nearly the same title, but no shared DOI or arXiv id. Have a look before merging.</p>
              <Groups groups={scan.likely} readOnly={props.readOnly} onMerge={setMerging} onDistinct={(g) => done("Marked as not the same.", props.onDistinct(g))} onOpen={props.onOpen} />
            </section>
          )}

          {ORDER.filter((k) => byKind.has(k)).map((k) => (
            <details key={k} id={`scan-${k}`} class="scan-section issue-list">
              <summary>
                {ISSUES[k].label} <span class="count">{byKind.get(k)!.length}</span>
              </summary>
              <p class="muted small">{ISSUES[k].help}</p>
              <ul class="dupes">
                {byKind
                  .get(k)!
                  .slice()
                  .sort((a, b) => (a.detail ?? "").localeCompare(b.detail ?? "") || a.paper.title.localeCompare(b.paper.title))
                  .slice(0, 300)
                  .map((i) => (
                    <li key={`${i.paper.id}${i.detail ?? ""}`}>
                      <div>
                        <span class="title">{i.paper.title || "(no title)"}</span>
                        <span class="meta"> {meta(i.paper) || `added ${added(i.paper)}`}</span>
                        {i.detail && <span class="issue-detail">{i.detail}</span>}
                      </div>
                      <div class="buttons">
                        {k === "missing-file" && !props.readOnly && (
                          <button class="small ghost" title="Take this file off the paper" onClick={() => props.onForgetFile(i.paper, i.detail!)}>Forget file</button>
                        )}
                        <button class="small" onClick={() => props.onOpen(i.paper.id)}>Open</button>
                      </div>
                    </li>
                  ))}
              </ul>
              {byKind.get(k)!.length > 300 && <p class="muted small">Showing the first 300.</p>}
            </details>
          ))}
        </>
      )}

      {merging && (
        <MergeDialog
          group={merging}
          onCancel={() => setMerging(null)}
          onMerge={async (keep, picks) => {
            setBusy(true);
            const others = merging.filter((p) => p.id !== keep.id);
            const u = await props.onMerge(keep, others, picks);
            setBusy(false);
            setMerging(null);
            done(`Merged ${merging.length} copies of “${keep.title.length > 60 ? `${keep.title.slice(0, 60)}…` : keep.title}”.`, u);
          }}
        />
      )}
    </div>
  );
}

function Groups(props: { groups: Paper[][]; readOnly: boolean; onMerge(g: Paper[]): void; onDistinct(g: Paper[]): void; onOpen(id: string): void }) {
  return (
    <ul class="dupe-groups">
      {props.groups.slice(0, 100).map((g) => {
        const keep = pickKeeper(g);
        return (
          <li key={g.map((p) => p.id).join()} class="dupe-group">
            {g.map((p) => (
              <button key={p.id} class={`dupe-copy ${p === keep ? "keep" : ""}`} onClick={() => props.onOpen(p.id)} title="Open this copy">
                <span class="title">{p.title || "(no title)"}</span>
                <span class="meta">{meta(p) || `added ${added(p)}`}{p === keep ? " · suggested to keep" : ""}</span>
                <span class="ids">{[p.key, p.doi && `doi ${p.doi}`, p.arxiv && `arXiv ${p.arxiv}`].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
            {!props.readOnly && (
              <div class="row">
                <button class="small primary" onClick={() => props.onMerge(g)}>Merge…</button>
                <button class="small ghost" onClick={() => props.onDistinct(g)}>Not the same</button>
              </div>
            )}
          </li>
        );
      })}
      {props.groups.length > 100 && <li class="muted small">And {props.groups.length - 100} more; merge these first.</li>}
    </ul>
  );
}

/** Choose the copy to keep and, where copies disagree, whose details win. */
export function MergeDialog(props: { group: Paper[]; onMerge(keep: Paper, picks: Picks): Promise<void>; onCancel(): void }) {
  const [keepId, setKeepId] = useState(() => pickKeeper(props.group).id);
  const keep = props.group.find((p) => p.id === keepId)!;
  const others = props.group.filter((p) => p.id !== keepId);
  const choices = useMemo(() => choicesFor(keep, props.group), [keepId]);
  const [picks, setPicks] = useState<Picks>({});
  const [working, setWorking] = useState(false);
  useEffect(() => setPicks({}), [keepId]);
  // Whose value each detail takes: the person's pick, else the keeper's, else the first copy that has one.
  const chosen = (field: Choosable) => picks[field] ?? choices.find((c) => c.field === field)!.options[0].from[0];
  const all: Picks = Object.fromEntries(choices.map((c) => [c.field, chosen(c.field)]));
  const result = mergeInto(keep, others, all);
  const tags = result.tags?.length ?? 0;
  const folders = result.folders?.length ?? 0;
  const fileCount = ((result.pdf ?? keep.pdf) ? 1 : 0) + (result.attachments?.length ?? 0);
  const notes = props.group.filter((p) => p.notes?.trim()).length;
  const label = (id: string) => {
    const i = props.group.findIndex((p) => p.id === id);
    return `copy ${i + 1}`;
  };

  return (
    <div class="overlay merge-overlay" onClick={(e) => e.target === e.currentTarget && props.onCancel()}>
      <div class="panel wide merge-dialog" role="dialog" aria-label="Merge duplicates">
        <h2>Merge {props.group.length} copies</h2>

        <h3>Keep this copy</h3>
        <p class="muted small">It keeps its id, so its PDF, highlights and chats stay where they are. The others go to the trash, marked as merged into it.</p>
        <div class="providers">
          {props.group.map((p, i) => (
            <label key={p.id} class={`provider ${p.id === keepId ? "on" : ""}`}>
              <input type="radio" name="keep" checked={p.id === keepId} onChange={() => setKeepId(p.id)} />
              <span>
                <b>Copy {i + 1}</b> <span class="muted small">added {added(p)} · {p.key}</span>
              </span>
              <span class="small">
                {p.title || "(no title)"}
                <span class="muted"> {meta(p)}</span>
              </span>
            </label>
          ))}
        </div>

        {choices.length > 0 && (
          <>
            <h3>Where they differ</h3>
            {choices.map((c) => (
              <fieldset key={c.field} class="merge-choice">
                <legend>{FIELD_LABEL[c.field]}</legend>
                {c.options.map((o) => (
                  <label key={o.from.join()} class={o.from.includes(chosen(c.field)) ? "on" : ""}>
                    <input
                      type="radio"
                      name={`pick-${c.field}`}
                      checked={o.from.includes(chosen(c.field))}
                      onChange={() => setPicks({ ...picks, [c.field]: o.from[0] })}
                    />
                    <span class={c.field === "abstract" ? "value abstract" : "value"}>{showValue(c.field, o.value)}</span>
                    <span class="from muted small">{o.from.map(label).join(", ")}</span>
                  </label>
                ))}
              </fieldset>
            ))}
          </>
        )}

        <h3>Brought together</h3>
        <ul class="merge-summary small">
          <li>{tags} tag{tags === 1 ? "" : "s"} and {folders} folder{folders === 1 ? "" : "s"} from all copies{result.starred ? ", starred" : ""}</li>
          {notes > 1 && <li>Notes from {notes} copies, one after the other</li>}
          <li>
            {fileCount} file{fileCount === 1 ? "" : "s"}
            {result.attachments?.length ? `: the main PDF and ${result.attachments.length} kept under Files` : ""}
          </li>
          {result.fields?.ids && <li>Other citation keys kept as aliases: {result.fields.ids.split(",").join(", ")}</li>}
          <li>Missing details filled in from the other copies; the earliest date added</li>
        </ul>

        <div class="row merge-actions">
          <button class="primary" disabled={working} onClick={async () => { setWorking(true); await props.onMerge(keep, all); }}>
            {working ? "Merging…" : `Merge into copy ${props.group.indexOf(keep) + 1}`}
          </button>
          <button class="ghost" onClick={props.onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
