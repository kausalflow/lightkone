import { useMemo, useRef, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { type Scope } from "./core/scope";
import { mentionLabel, mentionMatches } from "./core/mentions";
import { Icon } from "./icons";

/**
 * Choose the papers a chat reads: they are added one at a time, from a search
 * of the library, and each can be taken out again. There is no "whole
 * library" and no "select all", because every paper Claude reads is paid for
 * with the user's own API key. Questions can instead look at published
 * papers beyond the library.
 */
export function ScopePicker(props: {
  papers: Paper[];
  value: Scope;
  onChange(s: Scope): void;
  literature?: boolean;
  /** The most papers the tool takes. */
  max?: number;
  disabled?: boolean;
}) {
  const live = useMemo(() => props.papers.filter((p) => !p.trashed), [props.papers]);
  const byId = useMemo(() => new Map(live.map((p) => [p.id, p])), [live]);
  const beyond = props.value.kind === "literature";
  const ids = props.value.kind === "picked" ? props.value.ids.filter((id) => byId.has(id)) : [];
  const full = props.max !== undefined && ids.length >= props.max;
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const on = new Set(ids);
  const matches = query.trim() ? mentionMatches(live.filter((p) => !on.has(p.id)), query.trim()) : [];

  function add(p: Paper) {
    props.onChange({ kind: "picked", ids: [...ids, p.id] });
    setQuery("");
    setAt(0);
    box.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!matches.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAt((at + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      add(matches[Math.min(at, matches.length - 1)]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setQuery("");
    }
  }

  return (
    <div class="scope">
      {props.literature && (
        <div class="scope-kind" role="radiogroup" aria-label="What Claude reads">
          <button type="button" role="radio" aria-checked={!beyond} class={!beyond ? "on" : ""} disabled={props.disabled} onClick={() => beyond && props.onChange({ kind: "picked", ids: [] })}>
            Papers you add
          </button>
          <button type="button" role="radio" aria-checked={beyond} class={beyond ? "on" : ""} disabled={props.disabled} onClick={() => !beyond && props.onChange({ kind: "literature" })}>
            Published papers beyond your library
          </button>
        </div>
      )}
      {!beyond && (
        <>
          {ids.length > 0 && (
            <ul class="scope-chips" aria-label="Papers Claude reads">
              {ids.map((id) => {
                const p = byId.get(id)!;
                return (
                  <li key={id} class="chip" title={p.title}>
                    <span>{mentionLabel(p)}</span>
                    <button type="button" class="chip-x" disabled={props.disabled} onClick={() => props.onChange({ kind: "picked", ids: ids.filter((x) => x !== id) })} aria-label={`Take out ${p.title}`}>
                      <Icon name="x" size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {full ? (
            <p class="muted small">That is the most this takes ({props.max}). Take one out to add another.</p>
          ) : (
            <div class="scope-add">
              <input
                ref={box}
                type="search"
                value={query}
                disabled={props.disabled}
                placeholder={ids.length ? "Add another paper: title, author, year or key" : "Add a paper: title, author, year or key"}
                aria-label="Add a paper"
                onInput={(e) => { setQuery(e.currentTarget.value); setAt(0); }}
                onKeyDown={onKeyDown}
              />
              {query.trim() !== "" && (
                <ul class="mention-list scope-found" role="listbox" aria-label="Papers to add">
                  {matches.length ? (
                    matches.map((p, i) => (
                      <li key={p.id} role="option" aria-selected={i === at} class={i === at ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); add(p); }} onMouseEnter={() => setAt(i)}>
                        <span class="mention-title">{p.title}</span>
                        <span class="muted small">{mentionLabel(p)} · {p.key}</span>
                      </li>
                    ))
                  ) : (
                    <li class="muted small">
                      {mentionMatches(live, query.trim()).length ? "Already added." : `No paper matches “${query.trim()}”.`}
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
          {!ids.length && <p class="muted small">Add the papers Claude should read, one at a time.</p>}
        </>
      )}
    </div>
  );
}
