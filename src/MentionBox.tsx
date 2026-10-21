import { useRef, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { insertMention, mentionLabel, mentionMatches, openMention } from "./core/mentions";

/**
 * The question box of a chat. Typing [[ searches your papers; the one picked
 * goes in as [[key]] and joins what Claude reads. Enter sends, Shift+Enter
 * starts a new line.
 */
export function MentionBox(props: {
  value: string;
  papers: Paper[];
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onInput(v: string): void;
  onSubmit(e: Event): void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState<{ start: number; query: string } | null>(null);
  const [at, setAt] = useState(0);
  const matches = open ? mentionMatches(props.papers, open.query) : [];

  function look(el: HTMLTextAreaElement) {
    const m = openMention(el.value, el.selectionStart ?? el.value.length);
    setOpen(m);
    if (m?.query !== open?.query) setAt(0);
  }

  function pick(p: Paper) {
    const el = box.current;
    if (!el || !open) return;
    const next = insertMention(el.value, el.selectionStart ?? el.value.length, open.start, p.key);
    props.onInput(next.text);
    setOpen(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (open && matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setAt((at + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[Math.min(at, matches.length - 1)]);
        return;
      }
    }
    if (open && e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) props.onSubmit(e);
  }

  return (
    <div class="mention-box">
      {open && (
        <ul class="mention-list" role="listbox" aria-label="Papers to add to the chat">
          {matches.length ? (
            matches.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={i === at}
                class={i === at ? "on" : ""}
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                onMouseEnter={() => setAt(i)}
              >
                <span class="mention-title">{p.title}</span>
                <span class="muted small">{mentionLabel(p)} · {p.key}</span>
              </li>
            ))
          ) : (
            <li class="muted small">No paper matches “{open.query}”.</li>
          )}
        </ul>
      )}
      <textarea
        ref={box}
        rows={props.rows ?? 2}
        value={props.value}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        aria-label="Your question; type [[ to add a paper"
        onInput={(e) => { props.onInput(e.currentTarget.value); look(e.currentTarget); }}
        onKeyUp={(e) => !["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key) && look(e.currentTarget)}
        onClick={(e) => look(e.currentTarget)}
        onBlur={() => setTimeout(() => setOpen(null), 150)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

/** A question as shown in the chat, with each [[key]] as the paper's short name. */
export function QuestionText(props: { text: string; papers: Map<string, Paper> }) {
  const byKey = new Map([...props.papers.values()].map((p) => [p.key.toLowerCase(), p]));
  const parts = props.text.split(/(\[\[[^\]\n]+\]\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\[\[([^\]\n]+)\]\]$/.exec(part);
        const p = m ? byKey.get(m[1].trim().toLowerCase()) : undefined;
        return p ? <span key={i} class="chip mention" title={p.title}>{mentionLabel(p)}</span> : part;
      })}
    </>
  );
}
