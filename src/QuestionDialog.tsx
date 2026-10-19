import { useState } from "preact/hooks";

// A question a plugin asks while it runs, such as "What would you like to know
// about this paper?". It replaces the browser's own prompt(), which is a single
// line and, on a phone, hides the paper behind a system box.

export interface Question {
  title: string;
  placeholder?: string;
  answer(text: string | null): void;
}

export function QuestionDialog(props: { question: Question; subject?: string }) {
  const [text, setText] = useState("");
  const q = props.question;
  const send = (e?: Event) => {
    e?.preventDefault();
    if (text.trim()) q.answer(text.trim());
  };
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && q.answer(null)}>
      <form class="panel question-panel" onSubmit={send}>
        <h2>{q.title}</h2>
        {props.subject && <p class="muted subject">{props.subject}</p>}
        <textarea
          rows={4}
          value={text}
          autoFocus
          enterkeyhint="send"
          placeholder={q.placeholder}
          aria-label={q.title}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send(e);
            if (e.key === "Escape") q.answer(null);
          }}
        />
        <div class="row">
          <button class="primary" type="submit" disabled={!text.trim()}>Ask</button>
          <button type="button" onClick={() => q.answer(null)}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
