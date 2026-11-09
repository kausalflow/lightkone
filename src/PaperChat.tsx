import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { linkCitations, sourceLabel, sourcesPrompt, type Source } from "./core/ask";
import { mentionedPassages, mentionsAsNames, mentionsIn } from "./core/mentions";
import { MentionBox, QuestionText } from "./MentionBox";
import { newConversationId, type Conversation, type Turn } from "./core/history";
import { renderMarkdown } from "./core/markdown";
import { useMath } from "./core/math";
import { chatAboutPaper } from "./plugins/claude";
import { SavedNote } from "./SavedNote";

/**
 * A conversation about one paper: Claude reads the whole PDF (or the
 * abstract) with every question. Summaries, Ask Claude and explanations from
 * the reader carry on here too.
 */
export function PaperChat(props: {
  paper: Paper;
  /** The library, for [[ to name other papers. */
  papers: Paper[];
  texts: Map<string, string>;
  settings: Record<string, string>;
  resume?: Conversation;
  pdfOf(p: Paper): Promise<Uint8Array | null>;
  onRecord(c: Conversation): void;
  onOpen(paperId: string, page: number): void;
  /** Text to put in the question box, such as a passage from the reader; n changes for each new one. */
  seed?: { text: string; n: number };
  /** Off where a keyboard popping up would cover the page (the reader on a phone). */
  autoFocus?: boolean;
  /** Shown just above the question box, such as a note that the chat is getting long. */
  notice?: preact.ComponentChildren;
  /** Claude is answering (true) or done (false). */
  onBusy?(busy: boolean): void;
}) {
  const r = props.resume;
  const [turns, setTurns] = useState<Turn[]>(() => r?.turns ?? []);
  // Passages from other papers named with [[key]], numbered across the chat.
  const [sources, setSources] = useState<Source[]>(() => r?.sources ?? []);
  const byId = useMemo(() => new Map(props.papers.map((p) => [p.id, p])), [props.papers]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const conv = useRef<{ id: string; created: string } | null>(r ? { id: r.id, created: r.created } : null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const self = useRef<HTMLDivElement>(null);
  const math = useMath();
  const hasKey = Boolean(props.settings["claude.apiKey"]);
  // The last answer, when it was a saved one; and how to ask for it afresh.
  const [saved, setSaved] = useState<string | null>(null);
  const again = useRef<(() => void) | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (!props.seed) return;
    setQuestion((q) => (q.trim() ? `${q.trimEnd()}\n\n${props.seed!.text}` : props.seed!.text));
    requestAnimationFrame(() => {
      const box = self.current?.querySelector<HTMLTextAreaElement>(".ask-form textarea");
      box?.focus();
      box?.setSelectionRange(box.value.length, box.value.length);
    });
  }, [props.seed?.n]);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [turns.length, streaming]);

  async function ask(e: Event) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming !== null) return;
    const others = mentionsIn(q, props.papers).filter((p) => p.id !== props.paper.id);
    const found = mentionedPassages(others, props.texts, q.replace(/\[\[[^\]\n]+\]\]/g, " ")).map((x, i) => ({ ...x, n: sources.length + i + 1 }));
    const all = [...sources, ...found];
    const next: Turn[] = [...turns, { role: "user", text: q, sources: found.length ? sourcesPrompt(found, byId) : undefined }];
    setSources(all);
    setTurns(next);
    setQuestion("");
    setError(null);
    const run = async (fresh: boolean) => {
      setTurns(next);
      setSaved(null);
      setError(null);
      setStreaming("");
      props.onBusy?.(true);
      abort.current = new AbortController();
      try {
        const sent = next.map((t) => (t.role === "user" ? { ...t, text: mentionsAsNames(t.text, props.papers) } : t));
        let at: string | undefined;
        const answer = await chatAboutPaper(props.settings, props.paper, await props.pdfOf(props.paper), sent, setStreaming, abort.current.signal, { fresh, onSaved: (a) => (at = a) });
        const done: Turn[] = [...next, { role: "assistant", text: answer }];
        setTurns(done);
        setSaved(at ?? null);
        again.current = () => run(true);
        // The same first question as a chat already kept: that chat is in Chats; this one is kept once it goes further.
        if (at && !r && next.length === 1) return;
        const now = new Date().toISOString();
        conv.current ??= { id: newConversationId(), created: now };
        props.onRecord({
          ...(r ?? {}),
          id: conv.current.id,
          created: conv.current.created,
          kind: r?.kind ?? "paper",
          title: r?.title ?? mentionsAsNames(q, props.papers, false),
          updated: now,
          papers: [...new Set([props.paper.id, ...all.map((x) => x.paperId)])],
          preview: "",
          turns: done,
          sources: all.length ? all : undefined,
          paperId: props.paper.id,
          // A chat that brings in other papers belongs with that set of papers.
          focus: all.length ? [...new Set([props.paper.id, ...all.map((x) => x.paperId)])] : r?.focus,
        });
      } catch (err) {
        if (!abort.current.signal.aborted) setError((err as Error).message);
      } finally {
        setStreaming(null);
        props.onBusy?.(false);
      }
    };
    await run(false);
  }

  const label = (n: number) => {
    const x = sources.find((y) => y.n === n);
    return x ? sourceLabel(x, byId.get(x.paperId)) : null;
  };
  const render = (md: string) => (sources.length ? linkCitations(renderMarkdown(md, math), label) : renderMarkdown(md, math));
  // Typesetting long answers with math is slow: done once per answer, not on every redraw around it.
  const html = useMemo(() => turns.map((t) => (t.role === "assistant" ? render(t.text) : "")), [turns, sources, math]);
  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest<HTMLElement>("a.src");
    if (!a) return;
    e.preventDefault();
    const x = sources.find((y) => y.n === Number(a.dataset.src));
    if (x) props.onOpen(x.paperId, x.page);
  }
  // An explanation starts with the instruction given with the picture, which isn't worth showing again.
  const hideFirst = r?.kind === "explain";

  return (
    <div class="work paper-chat" ref={self} onClick={onClick}>
      {r?.quote && (
        <p class="quote">
          {r.quote}
          {r.page ? <> <button class="link small" onClick={() => props.onOpen(props.paper.id, r.page!)}>p. {r.page}</button></> : null}
        </p>
      )}
      {!turns.length && (
        <p class="muted">
          Claude reads {props.paper.pdf ? "the whole paper" : "the abstract (there is no PDF)"} with each question. Type [[ to bring in another paper from your library.
        </p>
      )}
      {!hasKey && <p class="error">Add your Anthropic API key under Settings → Claude first.</p>}
      <div class="ask-turns">
        {turns.map((t, i) =>
          t.role === "user" ? (
            hideFirst && i === 0 ? null : <p key={i} class="ask-q"><QuestionText text={t.text} papers={byId} /></p>
          ) : (
            <div key={i} class="answer" dangerouslySetInnerHTML={{ __html: html[i] }} />
          ),
        )}
        {saved && streaming === null && <SavedNote at={saved} onAgain={() => again.current?.()} disabled={!hasKey} />}
        {streaming !== null && <div class="answer" aria-live="polite" dangerouslySetInnerHTML={{ __html: streaming ? render(streaming) : '<p class="muted">Reading the paper…</p>' }} />}
        {error && <p class="error">{error}</p>}
        <div ref={bottom} />
      </div>
      <form class="ask-form" onSubmit={ask}>
        {props.notice}
        <MentionBox
          value={question}
          papers={props.papers}
          autoFocus={props.autoFocus ?? true}
          placeholder={turns.length ? "Ask a follow-up; [[ adds a paper" : "How does its assumption compare with [[…"}
          onInput={setQuestion}
          onSubmit={ask}
        />
        <div class="row">
          {streaming !== null ? (
            <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
          ) : (
            <button class="primary" type="submit" disabled={!question.trim() || !hasKey}>Ask</button>
          )}
        </div>
      </form>
    </div>
  );
}
