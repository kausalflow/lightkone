import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { retrieve, sourceLabel, sourcesPrompt, type Source } from "./core/ask";
import {
  inTurn, keysIn, paperText, parseColumns, parseRow, parseWeighing, reviewSources, silentPapers, STANCES, toCsv, toLatex, weighingMarkdown,
  type ReviewFormat, type Row, type Weighing,
} from "./core/compare";
import { firstPaper, papersText, saveScope, scoped, startScope, type Scope } from "./core/scope";
import { libraryToBibtex } from "./core/bibtex";
import { shortAuthors } from "./core/cite";
import { renderMarkdown } from "./core/markdown";
import { useMath } from "./core/math";
import { draftReview, extractRow, weighClaim } from "./plugins/claude";
import { newConversationId, type Conversation, type Kind } from "./core/history";
import { ScopePicker } from "./ScopePicker";
import { Icon } from "./icons";

const TABLE_MAX = 50;
const REVIEW_MAX = 60;
const COLUMNS_KEY = "lightkone.compare.columns";
const FORMAT_KEY = "lightkone.compare.format";

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function keep(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // private window, or full
  }
}
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type Tab = "table" | "weigh" | "review";


/**
 * Compare papers: a table of values read out of each paper, where papers
 * support or contradict a claim, and a draft literature review. Each works on
 * the papers chosen at the top, added one at a time.
 */
export function ComparePanel(props: {
  papers: Paper[];
  inView: Paper[];
  viewLabel: string;
  texts: Map<string, string>;
  settings: Record<string, string>;
  start?: Tab;
  /** A table, weighing or draft from Chats to open again. */
  resume?: Conversation;
  /** Papers to compare, chosen elsewhere (an Ask answer, a chat). */
  pick?: string[];
  onRecord(c: Conversation): void;
  onAskAbout(ids: string[]): void;
  onOpen(paperId: string, page: number): void;
}) {
  const r = props.resume;
  const tab: Tab = r ? (r.kind as Tab) : props.start ?? "table";
  const [has, setHas] = useState(Boolean(r));
  const [scope, setScope] = useState<Scope>(() =>
    startScope({ kept: r?.scope, keptPapers: r?.papers, pick: props.pick, tool: "compare", first: () => firstPaper(props.papers, props.inView) }),
  );
  const [busy, setBusy] = useState(false);
  const chosen = useMemo(() => scoped(props.papers, scope, props.inView), [props.papers, scope, props.inView]);
  const byId = useMemo(() => new Map(props.papers.map((p) => [p.id, p])), [props.papers]);
  const hasKey = Boolean(props.settings["claude.apiKey"]);
  // Each table, weighing or draft is kept in Chats once done; one opened from there keeps its place.
  function record(kind: Kind, id: { id: string; created: string }, title: string, papers: string[], data: unknown, sources?: Source[]) {
    props.onRecord({ id: id.id, kind, title, created: id.created, updated: new Date().toISOString(), papers, preview: "", turns: [], sources, scope, data });
  }
  const shared = { ...props, chosen, byId, hasKey, busy, setBusy, setHas, record, resume: r && r.kind === tab ? r : undefined };

  function pick(s: Scope) {
    setScope(s);
    saveScope("compare", s);
  }

  return (
    <div class="work compare-panel" aria-label="Compare papers">
      {/* Once there is a result, the papers chosen fold away so the result is in view, on a phone too. */}
      <details class="compare-setup" open={!has || busy} key={has ? "has" : "none"}>
        <summary>Reading {papersText(chosen.length)}</summary>
        <ScopePicker papers={props.papers} value={scope} onChange={pick} disabled={busy} max={tab === "table" ? TABLE_MAX : tab === "review" ? REVIEW_MAX : undefined} />
      </details>
      {!hasKey && <p class="error">Add your Anthropic API key under Settings → Claude first.</p>}
      {tab === "table" && <TableTab {...shared} />}
      {tab === "weigh" && <WeighTab {...shared} />}
      {tab === "review" && <ReviewTab {...shared} />}
    </div>
  );
}

interface TabProps {
  chosen: Paper[];
  byId: Map<string, Paper>;
  texts: Map<string, string>;
  settings: Record<string, string>;
  hasKey: boolean;
  busy: boolean;
  setBusy(b: boolean): void;
  /** Whether there is a result to show, so the setup can fold away. */
  setHas(b: boolean): void;
  resume?: Conversation;
  record(kind: Kind, id: { id: string; created: string }, title: string, papers: string[], data: unknown, sources?: Source[]): void;
  onAskAbout(ids: string[]): void;
  onOpen(paperId: string, page: number): void;
}

/** A conversation id for a new run, or the one opened from Chats. */
function useConv(resume?: Conversation) {
  const conv = useRef<{ id: string; created: string } | null>(resume ? { id: resume.id, created: resume.created } : null);
  return {
    fresh() {
      conv.current = { id: newConversationId(), created: new Date().toISOString() };
      return conv.current;
    },
    get current() {
      return conv.current;
    },
  };
}

function useStop() {
  const stop = useRef<AbortController | null>(null);
  useEffect(() => () => stop.current?.abort(), []);
  return stop;
}

function copy(text: string, done: (msg: string) => void, what: string) {
  navigator.clipboard?.writeText(text).then(() => done(`Copied ${what}.`), () => done("Could not copy."));
}

/** Pick columns; Claude reads each paper and fills its row, with the page each value is on. */
function TableTab(props: TabProps) {
  const saved = (props.resume?.data as { columns: string[]; rows: Row[] } | undefined) ?? null;
  const conv = useConv(props.resume);
  const [columnsText, setColumnsText] = useState(() => load<string>(COLUMNS_KEY, "Method, Data, Main result, Assumptions"));
  const [table, setTable] = useState<{ columns: string[]; rows: Row[] } | null>(saved);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const math = useMath();
  const stop = useStop();
  const columns = parseColumns(columnsText);
  const todo = props.chosen.slice(0, TABLE_MAX);

  async function fill(e: Event) {
    e.preventDefault();
    if (!columns.length || !todo.length) return;
    keep(COLUMNS_KEY, columnsText);
    stop.current = new AbortController();
    const signal = stop.current.signal;
    const rows: Row[] = todo.map((p) => ({ paperId: p.id, cells: null }));
    const show = () => {
      const t = { columns, rows: rows.filter((r) => r.cells || r.error) };
      setTable(t);
    };
    setTable({ columns, rows: [] });
    setNote(null);
    const id = conv.fresh();
    props.setBusy(true);
    let done = 0;
    setProgress([0, todo.length]);
    try {
      await inTurn(todo, 3, async (p, i) => {
        const { text, full, cut } = paperText(p, props.texts.get(p.id));
        try {
          const reply = await extractRow(props.settings, p, text, full, columns, signal);
          // Without the PDF's text there are no pages to point to.
          const cells = parseRow(reply, columns)?.map((c) => (full ? c : { ...c, page: 0 })) ?? null;
          rows[i] = cells ? { paperId: p.id, cells, abstractOnly: !full || undefined } : { paperId: p.id, cells: null, error: "Claude's reply could not be read." };
          if (cut && cells) rows[i].error = "Only the first part of a long paper was read.";
        } catch (err) {
          if (signal.aborted) return;
          rows[i] = { paperId: p.id, cells: null, error: (err as Error).message };
        }
        setProgress([++done, todo.length]);
        show();
      }, signal);
      if (signal.aborted) setNote("Stopped.");
      const kept = rows.filter((r) => r.cells || r.error);
      if (kept.length) props.record("table", id, columns.join(", "), kept.map((r) => r.paperId), { columns, rows: kept });
    } finally {
      props.setBusy(false);
      setProgress(null);
      stop.current = null;
    }
  }

  const rows = table?.rows ?? [];
  const cols = table?.columns ?? columns;
  const cell = (s: string) => renderMarkdown(s, math);
  useEffect(() => props.setHas(rows.length > 0), [rows.length > 0]);
  const paperName = (p?: Paper) => (p ? `${shortAuthors(p.authors) || p.title.slice(0, 40)}${p.year ? ` ${p.year}` : ""}` : "Removed paper");

  return (
    <>
      {!rows.length && <p class="muted">
        Name the columns. Claude reads each paper (the PDF's text when it has been read for search, otherwise the abstract) and fills its row, with the page each value comes from.
      </p>}
      <form onSubmit={fill}>
        <input type="text" value={columnsText} disabled={props.busy} aria-label="Columns, separated by commas" placeholder="Method, Data, Main result, Error bars, Assumptions" onInput={(e) => setColumnsText(e.currentTarget.value)} />
        <div class="row">
          {progress ? (
            <button type="button" onClick={() => stop.current?.abort()}>Stop</button>
          ) : (
            <button class="primary" type="submit" disabled={!props.hasKey || !columns.length || !todo.length}>
              Fill the table for {papersText(todo.length)}
            </button>
          )}
          {progress && <span class="muted small" role="status">Read {progress[0]} of {progress[1]}…</span>}
          {!progress && rows.length > 0 && (
            <>
              <button type="button" onClick={() => download("papers-table.csv", toCsv(rows, cols, props.byId), "text/csv")}><Icon name="download" size={15} /> CSV</button>
              <button type="button" onClick={() => copy(toLatex(rows, cols, props.byId), setNote, "the LaTeX table")}><Icon name="copy" size={15} /> LaTeX table</button>
              {rows.length > 1 && <button type="button" onClick={() => props.onAskAbout(rows.map((r) => r.paperId))}><Icon name="sparkle" size={15} /> Ask about these</button>}
            </>
          )}
        </div>
      </form>
      {note && <p class="message" role="status">{note}</p>}
      {rows.length > 0 && (
        <div class="compare-table">
          <table>
            <thead>
              <tr>
                <th>Paper</th>
                {cols.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = props.byId.get(r.paperId);
                return (
                  <tr key={r.paperId}>
                    <th scope="row">
                      <a href="#" onClick={(e) => { e.preventDefault(); props.onOpen(r.paperId, 0); }} title={p?.title}>
                        {p ? `${shortAuthors(p.authors) || p.title.slice(0, 40)}${p.year ? ` ${p.year}` : ""}` : "Removed paper"}
                      </a>
                      {r.abstractOnly && <span class="muted small"> · abstract only</span>}
                      {r.error && <span class="muted small"> · {r.error}</span>}
                    </th>
                    {cols.map((c, i) => {
                      const v = r.cells?.[i];
                      return (
                        <td key={c} title={v?.quote ? `“${v.quote}”` : undefined}>
                          {v ? <span class="cell" dangerouslySetInnerHTML={{ __html: cell(v.value) }} /> : null}
                          {v?.page ? <button class="link small" onClick={() => props.onOpen(r.paperId, v.page)}>p. {v.page}</button> : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        // On a narrow screen, each paper is a card with its values one under another.
        <ul class="compare-cards">
          {rows.map((r) => {
            const p = props.byId.get(r.paperId);
            return (
              <li key={r.paperId}>
                <a href="#" class="compare-card-title" onClick={(e) => { e.preventDefault(); props.onOpen(r.paperId, 0); }}>{paperName(p)}</a>
                {p && <span class="muted small"> {p.title}</span>}
                {r.abstractOnly && <span class="muted small"> · abstract only</span>}
                {r.error && <p class="muted small">{r.error}</p>}
                <dl>
                  {cols.map((c, i) => {
                    const v = r.cells?.[i];
                    return (
                      <div key={c}>
                        <dt>{c}</dt>
                        <dd>
                          {v ? <span class="cell" dangerouslySetInnerHTML={{ __html: cell(v.value) }} /> : <span class="muted">…</span>}
                          {v?.page ? <> <button class="link small" onClick={() => props.onOpen(r.paperId, v.page)}>p. {v.page}</button></> : null}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** A claim, and where the chosen papers support, qualify or contradict it. */
function WeighTab(props: TabProps) {
  const back = props.resume?.data as { claim: string; weighing: Weighing } | undefined;
  const [claim, setClaim] = useState(back?.claim ?? "");
  const [result, setResult] = useState<{ claim: string; weighing: Weighing; sources: Source[] } | null>(back ? { ...back, sources: props.resume!.sources ?? [] } : null);
  useEffect(() => props.setHas(Boolean(result)), [Boolean(result)]);
  const conv = useConv(props.resume);
  const [note, setNote] = useState<string | null>(null);
  const math = useMath();
  const stop = useStop();

  async function weigh(e: Event) {
    e.preventDefault();
    const c = claim.trim();
    if (!c) return;
    const sources = retrieve(props.chosen, props.texts, c, { max: 40, perPaper: 3, papers: 40 });
    if (!sources.length) {
      setNote("None of the chosen papers mention those words. Try other terms, or choose more papers.");
      return;
    }
    setNote(null);
    setResult(null);
    props.setBusy(true);
    stop.current = new AbortController();
    try {
      const reply = await weighClaim(props.settings, c, sourcesPrompt(sources, props.byId), stop.current.signal);
      const w = parseWeighing(reply, new Set(sources.map((s) => s.n)));
      if (!w) setNote("Claude's reply could not be read. Try again.");
      else {
        setResult({ claim: c, weighing: w, sources });
        const used = new Set(w.points.flatMap((p) => p.sources));
        // A new claim is a new conversation; the same one weighed again replaces it.
        const id = conv.current && back?.claim === c ? conv.current : conv.fresh();
        props.record("weigh", id, c, [...new Set(sources.filter((s) => used.has(s.n)).map((s) => s.paperId))], { claim: c, weighing: w }, sources.filter((s) => used.has(s.n)));
      }
    } catch (err) {
      if (!stop.current?.signal.aborted) setNote((err as Error).message);
    } finally {
      props.setBusy(false);
      stop.current = null;
    }
  }

  const name = (n: number) => {
    const s = result?.sources.find((x) => x.n === n);
    return s ? { s, label: sourceLabel(s, props.byId.get(s.paperId)) } : null;
  };
  const silent = result ? silentPapers(props.chosen, result.weighing.points, result.sources) : [];

  return (
    <>
      <p class="muted">State a claim. Lightkone finds the passages in the chosen papers that bear on it, and Claude sorts them into what supports, qualifies or contradicts it, with the page each point is from.</p>
      <form onSubmit={weigh}>
        <textarea rows={2} value={claim} disabled={props.busy} placeholder="Massive neutrinos suppress the matter power spectrum on small scales by about 8 f_ν." onInput={(e) => setClaim(e.currentTarget.value)} />
        <div class="row">
          {props.busy ? (
            <button type="button" onClick={() => stop.current?.abort()}>Stop</button>
          ) : (
            <button class="primary" type="submit" disabled={!props.hasKey || !claim.trim() || !props.chosen.length}>Weigh the evidence</button>
          )}
          {props.busy && <span class="muted small" role="status">Reading the passages…</span>}
          {result && !props.busy && (
            <button type="button" onClick={() => copy(weighingMarkdown(result.claim, result.weighing, result.sources, props.byId), setNote, "as Markdown")}>
              <Icon name="copy" size={15} /> Markdown
            </button>
          )}
          {result && !props.busy && result.weighing.points.length > 0 && (
            <button type="button" onClick={() => props.onAskAbout([...new Set(result.weighing.points.flatMap((p) => p.sources).map((n) => result.sources.find((s) => s.n === n)?.paperId).filter(Boolean) as string[])])}>
              <Icon name="sparkle" size={15} /> Ask about these
            </button>
          )}
        </div>
      </form>
      {note && <p class="message" role="status">{note}</p>}
      {result && (
        <div class="weighing">
          {result.weighing.summary && <div class="answer" dangerouslySetInnerHTML={{ __html: renderMarkdown(result.weighing.summary, math) }} />}
          {!result.weighing.points.length && <p class="muted">None of the passages found bear on the claim.</p>}
          {STANCES.map((st) => {
            const ps = result.weighing.points.filter((p) => p.stance === st.id);
            if (!ps.length) return null;
            return (
              <section key={st.id} class={`stance ${st.id}`}>
                <h3>{st.label}</h3>
                <ul>
                  {ps.map((p, i) => (
                    <li key={i}>
                      <span dangerouslySetInnerHTML={{ __html: renderMarkdown(p.text, math) }} />
                      <span class="srcs">
                        {p.sources.map((n) => {
                          const x = name(n);
                          return x ? (
                            <a key={n} href="#" class="src" onClick={(e) => { e.preventDefault(); props.onOpen(x.s.paperId, x.s.page); }}>{x.label}</a>
                          ) : null;
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {silent.length > 0 && silent.length < props.chosen.length && (
            <details class="silent">
              <summary class="muted small">{papersText(silent.length)} with nothing found on this</summary>
              <ul>
                {silent.slice(0, 100).map((p) => (
                  <li key={p.id}><a href="#" onClick={(e) => { e.preventDefault(); props.onOpen(p.id, 0); }}>{p.title}</a></li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </>
  );
}

/** A draft literature review of the chosen papers, in LaTeX or Markdown, citing them by their keys. */
function ReviewTab(props: TabProps) {
  const back = props.resume?.data as { focus: string; format: ReviewFormat; draft: string } | undefined;
  const [focus, setFocus] = useState(back?.focus ?? "");
  const [format, setFormat] = useState<ReviewFormat>(() => back?.format ?? load<ReviewFormat>(FORMAT_KEY, "latex"));
  const [draft, setDraft] = useState(back?.draft ?? "");
  useEffect(() => props.setHas(Boolean(draft)), [Boolean(draft)]);
  const conv = useConv(props.resume);
  const [note, setNote] = useState<string | null>(null);
  const stop = useStop();
  const papers = props.chosen.slice(0, REVIEW_MAX);

  async function write(e: Event) {
    e.preventDefault();
    if (!papers.length) return;
    setNote(null);
    setDraft("");
    props.setBusy(true);
    stop.current = new AbortController();
    try {
      const text = await draftReview(props.settings, reviewSources(papers, props.texts), focus, format, setDraft, stop.current.signal);
      setDraft(text);
      const cited = new Set(keysIn(text));
      props.record("review", conv.fresh(), focus.trim() || `Review of ${papersText(papers.length)}`, papers.filter((p) => cited.has(p.key)).map((p) => p.id), { focus, format, draft: text });
    } catch (err) {
      if (!stop.current?.signal.aborted) setNote((err as Error).message);
    } finally {
      props.setBusy(false);
      stop.current = null;
    }
  }

  function pickFormat(f: ReviewFormat) {
    setFormat(f);
    keep(FORMAT_KEY, f);
  }

  const keys = useMemo(() => new Set(papers.map((p) => p.key)), [papers]);
  const cited = keysIn(draft);
  const unknown = cited.filter((k) => !keys.has(k));
  const citedPapers = papers.filter((p) => cited.includes(p.key));
  const ext = format === "latex" ? "tex" : "md";

  return (
    <>
      <p class="muted">
        Claude drafts a review of the chosen papers from their abstracts and your notes, grouped by theme, citing each by its key, so it compiles against your .bib. Read it as a first draft: check every claim against the papers.
      </p>
      <form onSubmit={write}>
        <textarea rows={2} value={focus} disabled={props.busy} placeholder="Optional: what the review is for, e.g. the related-work section of a paper on emulators for the matter power spectrum." onInput={(e) => setFocus(e.currentTarget.value)} />
        <div class="row">
          <select value={format} disabled={props.busy} aria-label="Format" onChange={(e) => pickFormat(e.currentTarget.value as ReviewFormat)}>
            <option value="latex">LaTeX with \cite</option>
            <option value="markdown">Markdown with [@key]</option>
          </select>
          {props.busy ? (
            <button type="button" onClick={() => stop.current?.abort()}>Stop</button>
          ) : (
            <button class="primary" type="submit" disabled={!props.hasKey || !papers.length}>Draft a review of {papersText(papers.length)}</button>
          )}
        </div>
      </form>
      {note && <p class="message" role="status">{note}</p>}
      {(draft || props.busy) && (
        <>
          <textarea class="review-draft" rows={16} value={draft} readOnly={props.busy} placeholder="Writing…" onInput={(e) => setDraft(e.currentTarget.value)} aria-label="The review draft" />
          {!props.busy && draft && (
            <>
              {unknown.length > 0 && <p class="error">Not among the chosen papers: {unknown.join(", ")}. Remove or replace these citations.</p>}
              <div class="row">
                <button onClick={() => copy(draft, setNote, "the draft")}><Icon name="copy" size={15} /> Copy</button>
                <button onClick={() => download(`review.${ext}`, draft, format === "latex" ? "application/x-tex" : "text/markdown")}><Icon name="download" size={15} /> review.{ext}</button>
                {citedPapers.length > 0 && (
                  <button onClick={() => download("review.bib", libraryToBibtex(citedPapers), "application/x-bibtex")}><Icon name="download" size={15} /> .bib of the {papersText(citedPapers.length)} cited</button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
