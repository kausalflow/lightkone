import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { linkCitations, retrieve, sourceLabel, sourcesPrompt, type Source } from "./core/ask";
import { renderMarkdown } from "./core/markdown";
import { useMath } from "./core/math";
import { askLibrary, type LibraryTurn } from "./plugins/claude";
import { Icon } from "./icons";

/**
 * Ask a question across the whole library. Passages are found here, in the
 * browser, from the papers' texts and abstracts; Claude answers from them
 * and every citation opens the paper at its page.
 */
export function AskPanel(props: {
  papers: Paper[];
  texts: Map<string, string>;
  unindexed: number;
  settings: Record<string, string>;
  hidden?: boolean;
  onOpen(paperId: string, page: number): void;
  onIndex(): void;
  onClose(): void;
}) {
  const [turns, setTurns] = useState<LibraryTurn[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const math = useMath();
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(props.papers.map((p) => [p.id, p])), [props.papers]);
  const hasKey = Boolean(props.settings["claude.apiKey"]);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [turns.length, streaming]);

  async function ask(e: Event) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming !== null) return;
    // Passages already given to Claude are not sent again; new ones continue the numbering.
    const seen = new Set(sources.map((s) => `${s.paperId}:${s.page}:${s.text.slice(0, 60)}`));
    const found = retrieve(props.papers, props.texts, turns.length ? `${q} ${turns[0].text}` : q)
      .filter((s) => !seen.has(`${s.paperId}:${s.page}:${s.text.slice(0, 60)}`))
      .map((s, i) => ({ ...s, n: sources.length + i + 1 }));
    if (!turns.length && !found.length) {
      setError("Nothing in your library mentions those words. Try other terms, or read the PDFs for search first.");
      return;
    }
    const all = [...sources, ...found];
    const next: LibraryTurn[] = [...turns, { role: "user", text: q, sources: found.length ? sourcesPrompt(found, byId) : undefined }];
    setSources(all);
    setTurns(next);
    setQuestion("");
    setStreaming("");
    setError(null);
    abort.current = new AbortController();
    try {
      const answer = await askLibrary(props.settings, next, setStreaming, abort.current.signal);
      setTurns([...next, { role: "assistant", text: answer }]);
    } catch (err) {
      if (!abort.current.signal.aborted) setError((err as Error).message);
    } finally {
      setStreaming(null);
    }
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

  // The papers each answer drew on, for a list under it.
  const cited = (md: string) => {
    const ns = new Set([...md.matchAll(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g)].flatMap((m) => m[1].split(/\s*[,;]\s*/).map(Number)));
    const ids = [...new Set([...ns].map((n) => sources[n - 1]?.paperId).filter(Boolean))] as string[];
    return ids.map((id) => byId.get(id)).filter(Boolean) as Paper[];
  };

  return (
    <div class="overlay" hidden={props.hidden} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <section class="panel ask-panel" onClick={onClick} aria-label="Ask your library">
        <div class="ask-head">
          <h2>Ask your library</h2>
          <button class="icon-btn" onClick={props.onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {!turns.length && (
          <p class="muted">
            Claude answers from the papers in your library and cites the page each point comes from.
            {props.unindexed > 0 && (
              <>
                {" "}{props.unindexed} PDF{props.unindexed > 1 ? "s haven't" : " hasn't"} been read yet, so only {props.unindexed > 1 ? "their" : "its"} abstract counts.{" "}
                <button class="link" onClick={props.onIndex}>Read them now</button>
              </>
            )}
          </p>
        )}
        {!hasKey && <p class="error">Add your Anthropic API key under Settings → Claude first.</p>}
        <div class="ask-turns">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <p key={i} class="ask-q">{t.text}</p>
            ) : (
              <div key={i}>
                <div class="answer" dangerouslySetInnerHTML={{ __html: render(t.text) }} />
                {cited(t.text).length > 0 && (
                  <ul class="ask-cited">
                    {cited(t.text).map((p) => (
                      <li key={p.id}>
                        <a href="#" onClick={(e) => { e.preventDefault(); props.onOpen(p.id, 0); }}>{p.title}</a>
                        {p.year ? <span class="muted"> {p.year}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ),
          )}
          {streaming !== null && (
            <div class="answer" aria-live="polite" dangerouslySetInnerHTML={{ __html: streaming ? render(streaming) : '<p class="muted">Reading the passages…</p>' }} />
          )}
          {error && <p class="error">{error}</p>}
          <div ref={bottom} />
        </div>
        <form class="ask-form" onSubmit={ask}>
          <textarea
            rows={2}
            value={question}
            autoFocus
            placeholder={turns.length ? "Ask a follow-up" : "Which papers bound the neutrino mass, and how?"}
            onInput={(e) => setQuestion(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && ask(e)}
          />
          <div class="row">
            {streaming !== null ? (
              <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
            ) : (
              <button class="primary" type="submit" disabled={!question.trim() || !hasKey}>Ask</button>
            )}
            {turns.length > 0 && streaming === null && (
              <button type="button" onClick={() => { setTurns([]); setSources([]); setError(null); }}>New question</button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
