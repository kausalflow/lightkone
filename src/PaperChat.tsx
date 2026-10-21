import { useEffect, useRef, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { newConversationId, type Conversation, type Turn } from "./core/history";
import { renderMarkdown } from "./core/markdown";
import { useMath } from "./core/math";
import { chatAboutPaper } from "./plugins/claude";

/**
 * A conversation about one paper: Claude reads the whole PDF (or the
 * abstract) with every question. Summaries, Ask Claude and explanations from
 * the reader carry on here too.
 */
export function PaperChat(props: {
  paper: Paper;
  settings: Record<string, string>;
  resume?: Conversation;
  pdfOf(p: Paper): Promise<Uint8Array | null>;
  onRecord(c: Conversation): void;
  onOpen(paperId: string, page: number): void;
}) {
  const r = props.resume;
  const [turns, setTurns] = useState<Turn[]>(() => r?.turns ?? []);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const conv = useRef<{ id: string; created: string } | null>(r ? { id: r.id, created: r.created } : null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const math = useMath();
  const hasKey = Boolean(props.settings["claude.apiKey"]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [turns.length, streaming]);

  async function ask(e: Event) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming !== null) return;
    const next: Turn[] = [...turns, { role: "user", text: q }];
    setTurns(next);
    setQuestion("");
    setError(null);
    setStreaming("");
    abort.current = new AbortController();
    try {
      const answer = await chatAboutPaper(props.settings, props.paper, await props.pdfOf(props.paper), next, setStreaming, abort.current.signal);
      const done: Turn[] = [...next, { role: "assistant", text: answer }];
      setTurns(done);
      const now = new Date().toISOString();
      conv.current ??= { id: newConversationId(), created: now };
      props.onRecord({
        ...(r ?? {}),
        id: conv.current.id,
        created: conv.current.created,
        kind: r?.kind ?? "paper",
        title: r?.title ?? q,
        updated: now,
        papers: [props.paper.id],
        preview: "",
        turns: done,
        paperId: props.paper.id,
      });
    } catch (err) {
      if (!abort.current.signal.aborted) setError((err as Error).message);
    } finally {
      setStreaming(null);
    }
  }

  const render = (md: string) => renderMarkdown(md, math);
  // An explanation starts with the instruction given with the picture, which isn't worth showing again.
  const hideFirst = r?.kind === "explain";

  return (
    <div class="work paper-chat">
      {r?.quote && (
        <p class="quote">
          {r.quote}
          {r.page ? <> <button class="link small" onClick={() => props.onOpen(props.paper.id, r.page!)}>p. {r.page}</button></> : null}
        </p>
      )}
      {!turns.length && <p class="muted">Claude reads {props.paper.pdf ? "the whole paper" : "the abstract (there is no PDF)"} with each question.</p>}
      {!hasKey && <p class="error">Add your Anthropic API key under Settings → Claude first.</p>}
      <div class="ask-turns">
        {turns.map((t, i) =>
          t.role === "user" ? (
            hideFirst && i === 0 ? null : <p key={i} class="ask-q">{t.text}</p>
          ) : (
            <div key={i} class="answer" dangerouslySetInnerHTML={{ __html: render(t.text) }} />
          ),
        )}
        {streaming !== null && <div class="answer" aria-live="polite" dangerouslySetInnerHTML={{ __html: streaming ? render(streaming) : '<p class="muted">Reading the paper…</p>' }} />}
        {error && <p class="error">{error}</p>}
        <div ref={bottom} />
      </div>
      <form class="ask-form" onSubmit={ask}>
        <textarea
          rows={2}
          value={question}
          autoFocus
          placeholder={turns.length ? "Ask a follow-up" : "What is the key assumption, and where does it enter?"}
          onInput={(e) => setQuestion(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && ask(e)}
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
