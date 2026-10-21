import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Icon, type IconName } from "./icons";
import type { Paper } from "./core/types";

export interface Command {
  id: string;
  label: string;
  /** Where it belongs: Actions, Discover, Write, Go to, Folder, Tag… */
  group: string;
  icon: IconName;
  /** A line under the label. */
  hint?: string;
  /** More words it answers to. */
  keywords?: string;
  /** Shown only once something is typed, so the empty palette stays short. */
  onlyWhenTyped?: boolean;
  run(): void;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** How well a command answers the words typed; 0 when it doesn't. */
export function scoreCommand(c: Pick<Command, "label" | "group" | "keywords">, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const label = fold(c.label);
  const hay = `${label} ${fold(c.group)} ${fold(c.keywords ?? "")}`;
  let score = 0;
  for (const w of words) {
    if (!hay.includes(w)) return 0;
    if (label.startsWith(w)) score += 3;
    else if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) score += 2;
    else if (label.includes(w)) score += 1;
    else score += 0.5;
  }
  return score;
}

/** Papers whose title or authors hold every word typed, best first. */
export function matchPapers(papers: Paper[], query: string, max = 8): Paper[] {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const out: [Paper, number][] = [];
  for (const p of papers) {
    if (p.trashed) continue;
    const title = fold(p.title);
    const hay = `${title} ${fold(p.authors.join(" "))} ${p.year ?? ""} ${fold(p.key ?? "")}`;
    if (!words.every((w) => hay.includes(w))) continue;
    out.push([p, words.filter((w) => title.includes(w)).length]);
  }
  return out.sort((a, b) => b[1] - a[1]).slice(0, max).map(([p]) => p);
}

const surnames = (p: Paper) => {
  const a = p.authors.map((x) => x.split(",")[0]);
  return a.length > 2 ? `${a[0]} et al.` : a.join(", ");
};

/** Ctrl/⌘ K: type to find any tool, view, folder, tag or paper, and go there. */
export function CommandPalette(props: { commands: Command[]; papers: Paper[]; onOpenPaper(id: string): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const items = useMemo(() => {
    const typed = query.trim();
    const cmds = props.commands
      .filter((c) => typed || !c.onlyWhenTyped)
      .map((c, i) => ({ c, s: scoreCommand(c, typed), i }))
      .filter((x) => x.s > 0);
    // Typed: best first. Empty: in the order given, grouped.
    if (typed) cmds.sort((a, b) => b.s - a.s || a.i - b.i);
    const shown = cmds.slice(0, typed ? 12 : 40).map((x) => x.c);
    const papers: Command[] = matchPapers(props.papers, typed).map((p) => ({
      id: `paper:${p.id}`,
      label: p.title,
      group: "Papers",
      icon: "file",
      hint: [surnames(p), p.year].filter(Boolean).join(" · "),
      run: () => props.onOpenPaper(p.id),
    }));
    return [...shown, ...papers];
  }, [query, props.commands, props.papers]);

  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  function run(c: Command | undefined) {
    if (!c) return;
    props.onClose();
    c.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
      e.preventDefault();
      setAt((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
      e.preventDefault();
      setAt((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[at]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  }

  // Keys work wherever the focus is while the palette is open; typing goes to the box,
  // even if something behind took the focus as the palette opened.
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    input.current?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.metaKey || (e.ctrlKey && e.key !== "n" && e.key !== "p")) return;
      if (/^(Arrow(Up|Down)|Enter|Escape)$/.test(e.key) || (e.ctrlKey && (e.key === "n" || e.key === "p"))) {
        e.stopPropagation();
        keyRef.current(e);
      } else if (document.activeElement !== input.current && e.key.length === 1) input.current?.focus();
    };
    document.addEventListener("keydown", handle, true);
    return () => document.removeEventListener("keydown", handle, true);
  }, []);

  let lastGroup = "";
  return (
    <div class="overlay palette-overlay" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel palette" role="dialog" aria-label="Commands">
        <label class="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            placeholder="Find a tool, folder, tag or paper"
            aria-label="Find a command"
            aria-controls="palette-list"
            aria-activedescendant={items[at] ? `pal-${at}` : undefined}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <button class="ghost palette-esc" onClick={props.onClose} aria-label="Close">
            Esc
          </button>
        </label>
        <ul class="palette-list" id="palette-list" ref={list} role="listbox">
          {items.flatMap((c, i) => {
            const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
            const row = (
              <li
                key={c.id}
                id={`pal-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === at}
                class={i === at ? "on" : ""}
                onMouseMove={() => i !== at && setAt(i)}
                onClick={() => run(c)}
              >
                <Icon name={c.icon} />
                <span class="palette-text">
                  <span class="palette-label">{c.label}</span>
                  {c.hint && <span class="palette-hint">{c.hint}</span>}
                </span>
              </li>
            );
            return head ? [<li key={`g:${head}:${i}`} class="palette-group" role="presentation">{head}</li>, row] : [row];
          })}
          {!items.length && <li class="palette-none muted">Nothing matches “{query}”.</li>}
        </ul>
        <div class="palette-foot small muted hide-phone">
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
