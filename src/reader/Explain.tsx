import { useEffect, useRef, useState } from "preact/hooks";
import type { Paper } from "../core/types";
import type { Rect } from "../core/annotations";
import { loadSettings } from "../core/settings";
import { plainMath, renderMarkdown, type MathRenderer } from "../core/markdown";
import { chatAboutPaper, type ChatTurn } from "../plugins/claude";

export interface Subject {
  page: number;
  rects: Rect[];
  text: string;
  image: string | null;
}

// KaTeX is loaded the first time an answer needs it.
let katexMath: Promise<MathRenderer> | null = null;
function loadMath(): Promise<MathRenderer> {
  katexMath ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => (tex: string, display: boolean) =>
    k.default.renderToString(tex, { displayMode: display, throwOnError: false, output: "htmlAndMathml" }),
  );
  return katexMath;
}

/** Claude explains a selected passage, equation or figure, with follow-up questions. */
export function Explain(props: { paper: Paper; pdf: Uint8Array | null; subject: Subject; onClose(): void; onSave(answer: string): void }) {
  const { subject } = props;
  const settings = loadSettings();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [math, setMath] = useState<MathRenderer>(() => plainMath);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMath().then((m) => setMath(() => m), () => {});
  }, []);

  async function ask(next: ChatTurn[]) {
    setTurns(next);
    setStreaming("");
    setError(null);
    abort.current = new AbortController();
    try {
      const answer = await chatAboutPaper(settings, props.paper, props.pdf, next, setStreaming, abort.current.signal);
      setTurns([...next, { role: "assistant", text: answer }]);
    } catch (e) {
      if (!abort.current.signal.aborted) setError((e as Error).message);
    } finally {
      setStreaming(null);
    }
  }

  useEffect(() => {
    if (!settings["claude.apiKey"]) return;
    ask([
      {
        role: "user",
        text: `Explain this, from page ${subject.page}:\n\n"""${subject.text}"""${subject.image ? "\n\nThe picture shows the same part of the page as typeset." : ""}`,
        image: subject.image ?? undefined,
      },
    ]);
    return () => abort.current?.abort();
  }, []);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [turns.length, streaming]);

  const answers = turns.filter((t) => t.role === "assistant");
  const lastAnswer = answers[answers.length - 1]?.text;

  function followUp(e: Event) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming !== null) return;
    setQuestion("");
    ask([...turns, { role: "user", text: q }]);
  }

  return (
    <div class="reader-sheet explain-sheet" role="dialog" aria-label="Explanation">
      <div class="explain-head">
        <strong>Explain</strong>
        <span class="muted small">p. {subject.page}</span>
        <span class="spacer" />
        <button class="ghost small" onClick={props.onClose} aria-label="Close explanation">Close</button>
      </div>
      <div class="explain-body">
        <p class="quote">{subject.text}</p>
        {!settings["claude.apiKey"] && <p class="message">Add your Anthropic API key under Settings → Claude to have Claude explain passages.</p>}
        {turns.map((t, i) =>
          i === 0 ? null : t.role === "user" ? (
            <p key={i} class="explain-q">{t.text}</p>
          ) : (
            <div key={i} class="explain-a" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.text, math) }} />
          ),
        )}
        {streaming !== null &&
          (streaming ? (
            <div class="explain-a" dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming, math) }} />
          ) : (
            <p class="muted">Reading the paper…</p>
          ))}
        {error && <p class="message">{error}</p>}
        <div ref={bottom} />
      </div>
      {settings["claude.apiKey"] && (
        <form class="explain-ask" onSubmit={followUp}>
          <input value={question} placeholder="Ask a follow-up" onInput={(e) => setQuestion(e.currentTarget.value)} disabled={streaming !== null} />
          <button type="submit" disabled={!question.trim() || streaming !== null}>Ask</button>
          <button type="button" class="primary" disabled={!lastAnswer || streaming !== null} onClick={() => props.onSave(answers.map((a) => a.text).join("\n\n"))} title="Highlight the passage and keep this explanation as its note">
            Save as note
          </button>
        </form>
      )}
    </div>
  );
}
