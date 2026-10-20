import { useRef, useState } from "preact/hooks";
import { Icon, type IconName } from "./icons";

// Picking a paper's folders or tags: what it has shows as chips, and typing
// suggests what the library already uses, most used first, so names stay
// consistent. A name nobody has used yet is one tap on "Create".

/** Every value the papers use, most used first, then alphabetically. */
export function byUse(values: string[][]): string[] {
  const counts = new Map<string, number>();
  for (const vs of values) for (const v of vs) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
}

/** Suggestions for what is typed: whole-word starts first, then anywhere in the name. */
export function suggest(known: string[], chosen: string[], typed: string, max = 8): string[] {
  const free = known.filter((k) => !chosen.includes(k));
  const q = typed.trim().toLowerCase();
  if (!q) return free.slice(0, max);
  const starts = free.filter((k) => k.toLowerCase().split(/[\s/_-]+/).some((w) => w.startsWith(q)) || k.toLowerCase().startsWith(q));
  const inside = free.filter((k) => !starts.includes(k) && k.toLowerCase().includes(q));
  return [...starts, ...inside].slice(0, max);
}

export function ChipPicker(props: {
  label: string;
  values: string[];
  known: string[];
  icon?: IconName;
  placeholder: string;
  /** Tidies a typed name; null when it can't be used. */
  clean(s: string): string | null;
  onChange(values: string[]): void;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const options = suggest(props.known, props.values, text);
  const typed = props.clean(text);
  const isNew = typed && !props.values.includes(typed) && !props.known.some((k) => k.toLowerCase() === typed.toLowerCase());
  const rows = [...options.map((v) => ({ v, create: false })), ...(isNew ? [{ v: typed!, create: true }] : [])];

  function add(v: string) {
    if (!props.values.includes(v)) props.onChange([...props.values, v]);
    setText("");
    setActive(0);
    input.current?.focus();
  }
  const remove = (v: string) => props.onChange(props.values.filter((x) => x !== v));

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (rows.length ? (a + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length : 0));
    } else if (e.key === "Enter" || (e.key === "," && text.trim())) {
      e.preventDefault();
      // What is typed exactly wins over the highlighted suggestion only when nothing was chosen with the arrows.
      const exact = props.known.find((k) => k.toLowerCase() === text.trim().toLowerCase());
      const pick = exact ?? (text.trim() && open ? rows[active]?.v : undefined) ?? typed;
      if (pick) add(pick);
    } else if (e.key === "Backspace" && !text && props.values.length) {
      remove(props.values[props.values.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div class="picker">
      <div class={`picker-box ${open ? "focused" : ""}`} onClick={() => input.current?.focus()}>
        {props.values.map((v) => (
          <span class="chip" key={v}>
            {props.icon && <Icon name={props.icon} size={13} />}
            {v}
            <button type="button" class="link" aria-label={`Remove ${v}`} onClick={(e) => { e.stopPropagation(); remove(v); }}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          value={text}
          aria-label={props.label}
          placeholder={props.values.length ? "" : props.placeholder}
          autocapitalize="off"
          autocomplete="off"
          spellcheck={false}
          enterkeyhint="done"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onInput={(e) => { setText(e.currentTarget.value.replace(/,/g, "")); setActive(0); setOpen(true); }}
          onKeyDown={onKey}
        />
      </div>
      {open && rows.length > 0 && (
        // mousedown keeps the focus in the box, so several can be picked in a row.
        <ul class="picker-list" role="listbox" aria-label={props.label} onMouseDown={(e) => e.preventDefault()}>
          {rows.map((r, i) => (
            <li key={(r.create ? "+" : "") + r.v} role="option" aria-selected={i === active} class={i === active ? "on" : ""} onClick={() => add(r.v)}>
              {r.create ? <Icon name="plus" size={14} /> : props.icon ? <Icon name={props.icon} size={14} /> : <span class="hash">#</span>}
              {r.create ? <span>Create “{r.v}”</span> : <span>{r.v}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
