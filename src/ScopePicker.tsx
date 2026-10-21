import { useMemo, useState } from "preact/hooks";
import type { Paper } from "./core/types";
import { papersText, scoped, type Scope } from "./core/scope";
import { shortAuthors } from "./core/cite";

/**
 * Choose which papers a tool works on: the whole library, what is in view
 * (a folder, a tag, Starred or a search), papers picked one by one, or,
 * for questions, published papers beyond the library.
 */
export function ScopePicker(props: {
  papers: Paper[];
  inView: Paper[];
  /** What the view is called: "Physics/QFT", "tag: lattice", "All papers". */
  viewLabel: string;
  value: Scope;
  onChange(s: Scope): void;
  literature?: boolean;
  /** The most papers the tool takes; more are cut, and the picker says so. */
  max?: number;
  disabled?: boolean;
}) {
  const live = useMemo(() => props.papers.filter((p) => !p.trashed), [props.papers]);
  const viewing = props.inView.filter((p) => !p.trashed).length;
  const picked = props.value.kind === "picked" ? props.value.ids : [];
  const n = scoped(props.papers, props.value, props.inView).length;
  const showView = viewing !== live.length || props.value.kind === "view";

  function choose(kind: Scope["kind"]) {
    if (kind === "picked") props.onChange({ kind, ids: picked.length ? picked : props.inView.filter((p) => !p.trashed).slice(0, props.max ?? 20).map((p) => p.id) });
    else props.onChange({ kind } as Scope);
  }

  return (
    <div class="scope">
      <label class="scope-row">
        <span class="muted small">From</span>
        <select value={props.value.kind} disabled={props.disabled} onChange={(e) => choose(e.currentTarget.value as Scope["kind"])} aria-label="Which papers">
          <option value="all">Your whole library ({papersText(live.length)})</option>
          {showView && <option value="view">In view: {props.viewLabel} ({papersText(viewing)})</option>}
          <option value="picked">Papers you pick{props.value.kind === "picked" ? ` (${picked.length})` : ""}</option>
          {props.literature && <option value="literature">Published papers beyond your library</option>}
        </select>
      </label>
      {props.max && n > props.max && props.value.kind !== "literature" && (
        <p class="muted small">Only the first {props.max} are used. Pick a folder, a tag or a few papers to narrow it.</p>
      )}
      {props.value.kind === "picked" && <PaperChecklist papers={live} ids={picked} disabled={props.disabled} onChange={(ids) => props.onChange({ kind: "picked", ids })} />}
    </div>
  );
}

function PaperChecklist(props: { papers: Paper[]; ids: string[]; disabled?: boolean; onChange(ids: string[]): void }) {
  const [filter, setFilter] = useState("");
  const on = new Set(props.ids);
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = props.papers
    .filter((p) => !words.length || words.every((w) => `${p.title} ${p.authors.join(" ")} ${p.year ?? ""} ${p.key}`.toLowerCase().includes(w)))
    // Picked papers first, so they are easy to find and untick.
    .sort((a, b) => Number(on.has(b.id)) - Number(on.has(a.id)))
    .slice(0, 200);

  function toggle(id: string) {
    props.onChange(on.has(id) ? props.ids.filter((x) => x !== id) : [...props.ids, id]);
  }

  return (
    <div class="scope-pick">
      <div class="scope-pick-head">
        <input type="search" placeholder="Filter by title, author or year" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} aria-label="Filter papers" />
        {props.ids.length > 0 && <button type="button" class="link small" disabled={props.disabled} onClick={() => props.onChange([])}>Clear</button>}
      </div>
      <ul class="scope-list">
        {shown.map((p) => (
          <li key={p.id}>
            <label>
              <input type="checkbox" checked={on.has(p.id)} disabled={props.disabled} onChange={() => toggle(p.id)} />
              <span class="title">{p.title}</span>
              <span class="muted small">{[shortAuthors(p.authors), p.year].filter(Boolean).join(" ")}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
