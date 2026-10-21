import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper, StorageAdapter } from "./core/types";
import { linkCitations, sourceLabel } from "./core/ask";
import { conversationMarkdown, dayLabel, findEntries, KINDS, loadConversation, type Conversation, type Entry, type Kind } from "./core/history";
import { STANCES, type Row, type Weighing } from "./core/compare";
import { shortAuthors, unicodeMath } from "./core/cite";
import { renderMarkdown } from "./core/markdown";
import { useMath } from "./core/math";
import { papersText } from "./core/scope";
import { chatAboutPaper } from "./plugins/claude";
import { Icon } from "./icons";

/**
 * Everything asked of Claude, in one place: find a conversation, read it
 * again with its citations, follow up, or carry its papers on to Ask or
 * Compare.
 */
export function HistoryPanel(props: {
  entries: Entry[];
  storage: StorageAdapter | null;
  papers: Paper[];
  settings: Record<string, string>;
  /** Open on this conversation. */
  start?: string;
  /** List only the conversations about this paper. */
  paperId?: string;
  hidden?: boolean;
  onResume(c: Conversation): void;
  onRecord(c: Conversation): void;
  onRemove(id: string): void;
  onAskAbout(ids: string[]): void;
  onCompare(ids: string[]): void;
  onOpen(paperId: string, page: number): void;
  pdfOf(p: Paper): Promise<Uint8Array | null>;
  onClose(): void;
}) {
  const [open, setOpen] = useState<string | null>(props.start ?? null);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [paperId, setPaperId] = useState(props.paperId ?? "");
  const byId = useMemo(() => new Map(props.papers.map((p) => [p.id, p])), [props.papers]);
  const shown = findEntries(props.entries, q, kind, paperId || undefined);
  const about = paperId ? byId.get(paperId) : undefined;

  let lastDay = "";
  return (
    <div class="overlay" hidden={props.hidden} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <section class="panel wide history-panel" aria-label="History">
        <div class="ask-head">
          {open ? (
            <button class="ghost small" onClick={() => setOpen(null)}><Icon name="back" size={15} /> All conversations</button>
          ) : (
            <h2>History</h2>
          )}
          <button class="icon-btn" onClick={props.onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {open ? (
          <ConversationView key={open} id={open} {...props} byId={byId} onRemove={(id) => { props.onRemove(id); setOpen(null); }} />
        ) : (
          <>
            <p class="muted">Every question you asked Claude, every explanation, table, weighing and review draft, kept with your library. Open one to read it again, follow up, or take its papers further.</p>
            <div class="history-filters">
              <input type="search" value={q} placeholder="Find a conversation" aria-label="Find a conversation" onInput={(e) => setQ(e.currentTarget.value)} />
              <select value={kind} aria-label="Kind" onChange={(e) => setKind(e.currentTarget.value as Kind | "")}>
                <option value="">Everything</option>
                {(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}
              </select>
            </div>
            {about && (
              <p class="small">
                About <strong>{about.title}</strong> · <button class="link small" onClick={() => setPaperId("")}>Show all</button>
              </p>
            )}
            {!props.entries.length && <p class="muted">Nothing yet. Questions from Ask, Explain, Summarize and Compare papers will appear here.</p>}
            {props.entries.length > 0 && !shown.length && <p class="muted">No conversation matches.</p>}
            <ul class="history-list">
              {shown.slice(0, 300).flatMap((e) => {
                const day = dayLabel(e.updated);
                const head = day !== lastDay ? ((lastDay = day), <li key={`d:${day}`} class="history-day">{day}</li>) : null;
                const row = (
                  <li key={e.id}>
                    <button class="history-item" onClick={() => setOpen(e.id)}>
                      <span class="history-kind">{KINDS[e.kind]}</span>
                      <span class="history-title">{e.title}</span>
                      {e.preview && <span class="history-preview">{unicodeMath(e.preview)}</span>}
                      {e.papers.length > 0 && <span class="muted small">{papersText(e.papers.length)}</span>}
                    </button>
                  </li>
                );
                return head ? [head, row] : [row];
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function ConversationView(props: Parameters<typeof HistoryPanel>[0] & { id: string; byId: Map<string, Paper> }) {
  const [c, setC] = useState<Conversation | null>(null);
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const math = useMath();

  useEffect(() => {
    if (!props.storage) return;
    loadConversation(props.storage, props.id).then((x) => (x ? setC(x) : setMissing(true)));
    return () => abort.current?.abort();
  }, [props.id]);

  if (missing) return <p class="muted">This conversation could not be read. It may have been deleted on another device.</p>;
  if (!c) return <p class="muted">Opening…</p>;

  const paper = c.paperId ? props.byId.get(c.paperId) : undefined;
  const outside = new Map((c.outside ?? []).map((o) => [o.id, o]));
  const name = (paperId: string, page: number) => {
    const p = props.byId.get(paperId);
    const o = outside.get(paperId);
    const s = { n: 0, paperId, page, text: "" };
    return o ? `${shortAuthors(o.draft.authors ?? []) || o.draft.title.slice(0, 40)}${o.draft.year ? ` ${o.draft.year}` : ""}, abstract` : sourceLabel(s, p);
  };
  const label = (n: number) => {
    const s = c.sources?.find((x) => x.n === n);
    return s ? name(s.paperId, s.page) : null;
  };
  const render = (md: string) => linkCitations(renderMarkdown(md, math), label);
  const inLibrary = c.papers.filter((id) => props.byId.has(id));

  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest<HTMLElement>("a.src");
    if (!a) return;
    e.preventDefault();
    const s = c!.sources?.find((x) => x.n === Number(a.dataset.src));
    if (!s) return;
    const o = outside.get(s.paperId);
    if (o) {
      const link = o.draft.doi ? `https://doi.org/${o.draft.doi}` : o.draft.url;
      if (link) window.open(link, "_blank", "noopener");
    } else props.onOpen(s.paperId, s.page);
  }

  // A conversation about one paper continues here, with the paper's PDF.
  async function followUp(e: Event) {
    e.preventDefault();
    const text = question.trim();
    if (!text || !paper || streaming !== null) return;
    const turns = [...c!.turns, { role: "user" as const, text }];
    setC({ ...c!, turns });
    setQuestion("");
    setStreaming("");
    setNote(null);
    abort.current = new AbortController();
    try {
      const pdf = await props.pdfOf(paper);
      const answer = await chatAboutPaper(props.settings, paper, pdf, turns, setStreaming, abort.current.signal);
      const next: Conversation = { ...c!, turns: [...turns, { role: "assistant", text: answer }], updated: new Date().toISOString() };
      setC(next);
      props.onRecord(next);
    } catch (err) {
      if (!abort.current.signal.aborted) setNote((err as Error).message);
    } finally {
      setStreaming(null);
    }
  }

  function copy() {
    navigator.clipboard?.writeText(conversationMarkdown(c!, name)).then(() => setNote("Copied as Markdown."), () => setNote("Could not copy."));
  }

  const resumable = ["ask", "beyond", "table", "weigh", "review"].includes(c.kind);
  const chat = (c.kind === "paper" || c.kind === "explain") && paper;

  return (
    <div class="history-view" onClick={onClick}>
      <p class="history-kind">{KINDS[c.kind]} · {new Date(c.created).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>
      <h3 class="history-heading">{c.title}</h3>
      {paper && (
        <p class="small">
          <a href="#" onClick={(e) => { e.preventDefault(); props.onOpen(paper.id, c.page ?? 0); }}>{paper.title}</a>
          {c.page ? <span class="muted"> · p. {c.page}</span> : null}
        </p>
      )}
      {c.quote && <p class="quote">{c.quote}</p>}

      {c.turns.map((t, i) =>
        t.role === "user" ? (
          i === 0 && (c.kind !== "ask" && c.kind !== "beyond") ? null : <p key={i} class="ask-q">{t.text}</p>
        ) : (
          <div key={i} class="answer" dangerouslySetInnerHTML={{ __html: render(t.text) }} />
        ),
      )}
      {streaming !== null && <div class="answer" dangerouslySetInnerHTML={{ __html: streaming ? render(streaming) : '<p class="muted">Reading the paper…</p>' }} />}
      {c.kind === "table" && <TableView data={c.data as { columns: string[]; rows: Row[] }} byId={props.byId} />}
      {c.kind === "weigh" && <WeighView data={c.data as { weighing: Weighing }} render={render} />}
      {c.kind === "review" && <pre class="review-draft">{(c.data as { draft?: string })?.draft ?? ""}</pre>}

      {chat && (
        <form class="ask-form" onSubmit={followUp}>
          <textarea rows={2} value={question} placeholder="Ask a follow-up about this paper" onInput={(e) => setQuestion(e.currentTarget.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && followUp(e)} />
          <div class="row">
            {streaming !== null ? (
              <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
            ) : (
              <button class="primary" type="submit" disabled={!question.trim() || !props.settings["claude.apiKey"]}>Ask</button>
            )}
          </div>
        </form>
      )}
      {note && <p class="message" role="status">{note}</p>}
      <div class="row history-actions">
        {resumable && (
          <button class="primary" onClick={() => props.onResume(c)}>
            {c.kind === "ask" || c.kind === "beyond" ? "Continue in Ask" : "Open in Compare papers"}
          </button>
        )}
        {inLibrary.length > 1 && <button onClick={() => props.onCompare(inLibrary)}><Icon name="table" size={15} /> Compare these {papersText(inLibrary.length)}</button>}
        {inLibrary.length > 0 && c.kind !== "ask" && <button onClick={() => props.onAskAbout(inLibrary)}><Icon name="sparkle" size={15} /> Ask about {inLibrary.length === 1 ? "this paper" : `these ${papersText(inLibrary.length)}`}</button>}
        <button onClick={copy}><Icon name="copy" size={15} /> Markdown</button>
        <button class="link small danger" onClick={() => confirm("Delete this conversation from your history?") && props.onRemove(c.id)}>Delete</button>
      </div>
    </div>
  );
}

function TableView(props: { data: { columns: string[]; rows: Row[] } | undefined; byId: Map<string, Paper> }) {
  if (!props.data?.rows?.length) return null;
  return (
    <div class="compare-table">
      <table>
        <thead>
          <tr><th>Paper</th>{props.data.columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {props.data.rows.map((r) => {
            const p = props.byId.get(r.paperId);
            return (
              <tr key={r.paperId}>
                <th scope="row">{p ? `${shortAuthors(p.authors) || p.title.slice(0, 40)}${p.year ? ` ${p.year}` : ""}` : "Removed paper"}</th>
                {props.data!.columns.map((c, i) => <td key={c}>{r.cells?.[i]?.value ?? r.error ?? ""}{r.cells?.[i]?.page ? <span class="muted small"> p. {r.cells[i].page}</span> : null}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WeighView(props: { data: { weighing: Weighing } | undefined; render(md: string): string }) {
  const w = props.data?.weighing;
  if (!w) return null;
  // Points cite their sources as [n], so the same links as Ask apply.
  const md = [w.summary, ...STANCES.flatMap((s) => {
    const ps = w.points.filter((p) => p.stance === s.id);
    return ps.length ? [`**${s.label}**`, ...ps.map((p) => `- ${p.text}${p.sources.length ? ` [${p.sources.join(", ")}]` : ""}`)] : [];
  })].join("\n\n");
  return <div class="answer" dangerouslySetInnerHTML={{ __html: props.render(md) }} />;
}
