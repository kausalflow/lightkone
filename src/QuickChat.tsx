import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { linkCitations, retrieve, sourceLabel, sourcesPrompt, type Source } from "./core/ask";
import { newConversationId, type Conversation, type Turn } from "./core/history";
import { shortAuthors } from "./core/cite";
import { renderMarkdown } from "./core/markdown";
import { useMath } from "./core/math";
import { askLibrary, chatAboutPaper } from "./plugins/claude";
import { Icon } from "./icons";

/**
 * A small chat that pops out over whatever you are doing, for a quick
 * question: about the paper open or selected, or about the library. It is
 * kept in History like everything else, and "Keep working" snaps it to the
 * side as a full conversation.
 */
export function QuickChat(props: {
  papers: Paper[];
  texts: Map<string, string>;
  settings: Record<string, string>;
  /** The paper being read or selected, which questions are about unless you switch to the library. */
  paper?: Paper;
  pdfOf(p: Paper): Promise<Uint8Array | null>;
  onRecord(c: Conversation): void;
  onKeep(c: Conversation): void;
  onOpen(paperId: string, page: number): void;
  onClose(): void;
}) {
  const [aboutId, setAboutId] = useState<string | null>(props.paper?.id ?? null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const conv = useRef<Conversation | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const math = useMath();
  const byId = useMemo(() => new Map(props.papers.map((p) => [p.id, p])), [props.papers]);
  const about = aboutId ? byId.get(aboutId) : undefined;
  const hasKey = Boolean(props.settings["claude.apiKey"]);

  // Before the first question, follow whatever paper is open or selected.
  useEffect(() => {
    if (!turns.length) setAboutId(props.paper?.id ?? null);
  }, [props.paper?.id]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [turns.length, streaming]);
  useEffect(() => input.current?.focus(), []);

  async function ask(e: Event) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming !== null) return;
    setQuestion("");
    setError(null);
    setStreaming("");
    abort.current = new AbortController();
    let all = sources;
    let next: Turn[];
    if (about) {
      next = [...turns, { role: "user", text: q }];
    } else {
      const seen = new Set(sources.map((s) => `${s.paperId}:${s.page}:${s.text.slice(0, 60)}`));
      const found = retrieve(props.papers, props.texts, turns.length ? `${q} ${turns[0].text}` : q)
        .filter((s) => !seen.has(`${s.paperId}:${s.page}:${s.text.slice(0, 60)}`))
        .map((s, i) => ({ ...s, n: sources.length + i + 1 }));
      if (!turns.length && !found.length) {
        setStreaming(null);
        setError("Nothing in your library mentions those words. Try other terms.");
        return;
      }
      all = [...sources, ...found];
      next = [...turns, { role: "user", text: q, sources: found.length ? sourcesPrompt(found, byId) : undefined }];
      setSources(all);
    }
    setTurns(next);
    try {
      const answer = about
        ? await chatAboutPaper(props.settings, about, await props.pdfOf(about), next, setStreaming, abort.current.signal)
        : await askLibrary(props.settings, next, setStreaming, abort.current.signal);
      const done: Turn[] = [...next, { role: "assistant", text: answer }];
      setTurns(done);
      const now = new Date().toISOString();
      const cited = new Set([...answer.matchAll(/\[(\d+)/g)].map((m) => Number(m[1])));
      conv.current = {
        id: conv.current?.id ?? newConversationId(),
        kind: about ? "paper" : "ask",
        title: done[0].text,
        created: conv.current?.created ?? now,
        updated: now,
        papers: about ? [about.id] : [...new Set(all.filter((s) => cited.has(s.n)).map((s) => s.paperId))],
        preview: "",
        turns: done,
        sources: about ? undefined : all,
        paperId: about?.id,
        scope: about ? undefined : { kind: "all" },
      };
      props.onRecord(conv.current);
    } catch (err) {
      if (!abort.current.signal.aborted) setError((err as Error).message);
    } finally {
      setStreaming(null);
    }
  }

  function fresh() {
    abort.current?.abort();
    setTurns([]);
    setSources([]);
    setError(null);
    conv.current = null;
    setAboutId(props.paper?.id ?? null);
    input.current?.focus();
  }

  const label = (n: number) => {
    const s = sources[n - 1];
    return s ? sourceLabel(s, byId.get(s.paperId)) : null;
  };
  const render = (md: string) => linkCitations(renderMarkdown(md, math), label);
  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest<HTMLElement>("a.src");
    if (!a) return;
    e.preventDefault();
    const s = sources[Number(a.dataset.src) - 1];
    if (s) props.onOpen(s.paperId, s.page);
  }

  return (
    <section class="quick" role="dialog" aria-label="Quick question" onClick={onClick} onKeyDown={(e) => e.key === "Escape" && props.onClose()}>
      <div class="quick-head">
        <Icon name="chat" size={16} />
        <strong>Quick question</strong>
        <span class="spacer" />
        {conv.current && streaming === null && (
          <button class="icon-btn" onClick={() => props.onKeep(conv.current!)} title="Keep working on this: snap it to the side" aria-label="Keep working on this">
            <Icon name="dockRight" size={18} />
          </button>
        )}
        {turns.length > 0 && (
          <button class="icon-btn" onClick={fresh} title="New question" aria-label="New question"><Icon name="plus" size={18} /></button>
        )}
        <button class="icon-btn" onClick={props.onClose} title="Close (it stays in History)" aria-label="Close"><Icon name="x" size={18} /></button>
      </div>
      <div class="quick-about">
        {about ? (
          <span class="chip" title={about.title}>
            About {shortAuthors(about.authors) || about.title.slice(0, 30)}{about.year ? ` ${about.year}` : ""}
            {!turns.length && <button class="icon-btn" onClick={() => setAboutId(null)} aria-label="Ask the whole library instead"><Icon name="x" size={12} /></button>}
          </span>
        ) : (
          <span class="chip">Your whole library</span>
        )}
        {!about && !turns.length && props.paper && (
          <button class="link small" onClick={() => setAboutId(props.paper!.id)}>Ask about the open paper</button>
        )}
      </div>
      <div class="quick-turns">
        {!turns.length && !error && (
          <p class="muted small">{about ? "Claude reads this paper and answers." : "Claude answers from your papers and cites the page."} It's kept in History.</p>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? <p key={i} class="ask-q">{t.text}</p> : <div key={i} class="answer" dangerouslySetInnerHTML={{ __html: render(t.text) }} />,
        )}
        {streaming !== null && <div class="answer" dangerouslySetInnerHTML={{ __html: streaming ? render(streaming) : '<p class="muted">Reading…</p>' }} />}
        {error && <p class="error small">{error}</p>}
        {!hasKey && <p class="error small">Add your Anthropic API key under Settings → Claude first.</p>}
        <div ref={bottom} />
      </div>
      <form class="quick-form" onSubmit={ask}>
        <textarea
          ref={input}
          rows={1}
          value={question}
          placeholder={turns.length ? "Follow up" : about ? "What is the key assumption here?" : "Ask your library"}
          onInput={(e) => setQuestion(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && ask(e)}
          aria-label="Your question"
        />
        {streaming !== null ? (
          <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
        ) : (
          <button class="primary" type="submit" disabled={!question.trim() || !hasKey} aria-label="Ask"><Icon name="chevron" size={16} /></button>
        )}
      </form>
    </section>
  );
}
