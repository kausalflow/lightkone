import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper, PaperDraft, StorageAdapter } from "./core/types";
import { sourceLabel } from "./core/ask";
import {
  conversationMarkdown, dayLabel, findEntries, groupEntries, KINDS, loadConversation, titleOf, topicsOf,
  type Conversation, type Entry, type GroupBy, type Kind, type Organize,
} from "./core/history";
import { shortAuthors, unicodeMath } from "./core/cite";
import { papersText } from "./core/scope";
import { AskPanel } from "./AskPanel";
import { ComparePanel, type Tab } from "./ComparePanel";
import { PaperChat } from "./PaperChat";
import { PanelFrame, type DockTab, type Place } from "./PanelFrame";
import { Icon } from "./icons";

export type Mode = "ask" | Tab;

/** How a new chat starts: what it does, and about which papers. */
export interface Start {
  mode: Mode;
  /** Papers chosen elsewhere: a paper's details, an answer's citations, a table. */
  ids?: string[];
}

const MODES: [Mode, string][] = [["ask", "Ask"], ["table", "Table"], ["weigh", "Agree or disagree"], ["review", "Review draft"]];
const GROUP_KEY = "lightkone.chats.group";

type View = { kind: "list" } | { kind: "open"; id: string } | { kind: "new"; start: Start; n: number };

/**
 * Every conversation with Claude in one place, gathered by the paper or set of
 * papers it was about. Ask, tables, weighings, review drafts and chats about a
 * paper all open and carry on here; each can be renamed, pinned and given
 * topics, and found by its words.
 */
export function ChatsPanel(props: {
  entries: Entry[];
  storage: StorageAdapter | null;
  papers: Paper[];
  inView: Paper[];
  viewLabel: string;
  texts: Map<string, string>;
  unindexed: number;
  settings: Record<string, string>;
  /** Open on this conversation. */
  open?: string;
  /** Start a new chat. */
  start?: Start;
  /** List only the chats about this paper. */
  paperId?: string;
  hidden?: boolean;
  front?: boolean;
  place?: Place;
  tabs?: DockTab[];
  onPlace?(p: Place): void;
  onRecord(c: Conversation): void;
  onOrganize(id: string, change: Organize): void;
  onRemove(id: string): void;
  onOpen(paperId: string, page: number): void;
  onIndex(): void;
  onAdd(d: PaperDraft): boolean;
  pdfOf(p: Paper): Promise<Uint8Array | null>;
  onClose(): void;
}) {
  const [view, setView] = useState<View>(() =>
    props.open ? { kind: "open", id: props.open } : props.start ? { kind: "new", start: props.start, n: 0 } : { kind: "list" },
  );
  // A new chat becomes a conversation once Claude has answered; its name and topics can be set from then.
  const [live, setLive] = useState<string | null>(null);
  const [paperId, setPaperId] = useState(props.paperId ?? "");
  const byId = useMemo(() => new Map(props.papers.map((p) => [p.id, p])), [props.papers]);
  const self = useRef<HTMLDivElement>(null);
  const [wideBox, setWideBox] = useState(false);

  // Side by side when there is room: the list, and the chat open.
  useEffect(() => {
    const el = self.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => setWideBox(el.clientWidth >= 720));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const name = (ids: string[]) => papersName(ids, byId);
  const current = view.kind === "open" ? view.id : view.kind === "new" ? live : null;
  const entry = current ? props.entries.find((e) => e.id === current) : undefined;

  function start(s: Start) {
    setLive(null);
    setView((v) => ({ kind: "new", start: s, n: (v.kind === "new" ? v.n : 0) + 1 }));
  }
  function record(c: Conversation) {
    props.onRecord(c);
    if (view.kind === "new") setLive(c.id);
  }

  const list = (
    <ChatList
      entries={props.entries}
      byId={byId}
      name={name}
      active={current}
      paperId={paperId}
      onPaper={setPaperId}
      onPick={(id) => { setLive(null); setView({ kind: "open", id }); }}
      onNew={start}
    />
  );

  let work = null;
  if (view.kind === "open") {
    work = <OpenChat key={view.id} id={view.id} {...props} entry={entry} byId={byId} name={name} onNew={start} onRemove={(id) => { props.onRemove(id); setView({ kind: "list" }); }} />;
  } else if (view.kind === "new") {
    work = (
      <NewChat key={view.n} {...props} start={view.start} byId={byId} name={name} entry={entry} onRecord={record} onNew={start}
        onRemove={(id) => { props.onRemove(id); setView({ kind: "list" }); }} />
    );
  }

  return (
    <PanelFrame
      place={props.place ?? "modal"}
      class="wide chats-panel"
      label="Chats"
      title="Chats"
      hidden={props.hidden}
      front={props.front}
      tabs={props.tabs}
      onPlace={props.onPlace}
      onClose={props.onClose}
    >
      <div ref={self} class={`chats ${wideBox ? "split" : ""}`}>
        {(wideBox || view.kind === "list") && <aside class="chats-nav">{list}</aside>}
        {view.kind !== "list" && (
          <div class="chats-work">
            {!wideBox && (
              <button class="ghost small history-back" onClick={() => { setLive(null); setView({ kind: "list" }); }}>
                <Icon name="back" size={15} /> All chats
              </button>
            )}
            {work}
          </div>
        )}
        {wideBox && view.kind === "list" && (
          <div class="chats-work chats-empty">
            <p class="muted">Pick a chat to read it again and carry on, or start a new one.</p>
          </div>
        )}
      </div>
    </PanelFrame>
  );
}

/** "Vaswani et al. 2017", "Vaswani 2017 + Amatriain 2023", "Vaswani 2017 and 4 more". */
export function papersName(ids: string[], byId: Map<string, Paper>): string {
  const short = (id: string) => {
    const p = byId.get(id);
    if (!p) return "a removed paper";
    const who = p.authors.length ? p.authors[0].split(",")[0].trim() : p.title.slice(0, 30);
    return `${who}${p.year ? ` ${p.year}` : ""}`;
  };
  if (ids.length === 1) {
    const p = byId.get(ids[0]);
    return p ? `${shortAuthors(p.authors) || p.title.slice(0, 40)}${p.year ? ` ${p.year}` : ""}` : "A removed paper";
  }
  if (ids.length <= 3) return ids.map(short).join(" + ");
  return `${short(ids[0])} + ${short(ids[1])} and ${ids.length - 2} more`;
}

function ChatList(props: {
  entries: Entry[];
  byId: Map<string, Paper>;
  name(ids: string[]): string;
  active: string | null;
  paperId: string;
  onPaper(id: string): void;
  onPick(id: string): void;
  onNew(s: Start): void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [topic, setTopic] = useState("");
  const [by, setBy] = useState<GroupBy>(() => {
    try {
      return (localStorage.getItem(GROUP_KEY) as GroupBy) || "papers";
    } catch {
      return "papers";
    }
  });
  const topics = topicsOf(props.entries);
  const shown = findEntries(props.entries, q, kind, props.paperId || undefined, topic || undefined);
  const groups = groupEntries(shown.slice(0, 400), by, props.name);
  const about = props.paperId ? props.byId.get(props.paperId) : undefined;

  function group(g: GroupBy) {
    setBy(g);
    try {
      localStorage.setItem(GROUP_KEY, g);
    } catch {
      // private window
    }
  }

  return (
    <>
      <div class="chats-top">
        <button class="primary" onClick={() => props.onNew({ mode: "ask", ids: props.paperId ? [props.paperId] : undefined })}>
          <Icon name="plus" size={15} /> New chat
        </button>
        <input type="search" value={q} placeholder="Find a chat" aria-label="Find a chat" onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      <div class="chats-filters">
        <select value={by} aria-label="Gather by" onChange={(e) => group(e.currentTarget.value as GroupBy)}>
          <option value="papers">By papers</option>
          <option value="date">By date</option>
          <option value="topic">By topic</option>
        </select>
        <select value={kind} aria-label="Kind" onChange={(e) => setKind(e.currentTarget.value as Kind | "")}>
          <option value="">All kinds</option>
          {(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}>{KINDS[k]}</option>)}
        </select>
        {topics.length > 0 && (
          <select value={topic} aria-label="Topic" onChange={(e) => setTopic(e.currentTarget.value)}>
            <option value="">Any topic</option>
            {topics.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>
      {about && (
        <p class="small chats-about">
          About <strong>{about.title}</strong> · <button class="link small" onClick={() => props.onPaper("")}>Show all</button>
        </p>
      )}
      {!props.entries.length && (
        <p class="muted small">
          Nothing yet. Questions to your library, chats about a paper, explanations from the reader, tables, weighings and review drafts all gather here.
        </p>
      )}
      {props.entries.length > 0 && !shown.length && <p class="muted small">No chat matches.</p>}
      <div class="chats-groups">
        {groups.map((g) => (
          <section key={g.key} class="chats-group">
            <header>
              <span class="chats-group-name" title={g.papers?.map((id) => props.byId.get(id)?.title).filter(Boolean).join("\n")}>{g.label}</span>
              <span class="muted small">{g.entries.length}</span>
              {g.papers && (
                <button class="icon-btn" onClick={() => props.onNew({ mode: "ask", ids: g.papers })} title={`New chat about ${g.papers.length === 1 ? "this paper" : "these papers"}`} aria-label={`New chat about ${g.label}`}>
                  <Icon name="plus" size={15} />
                </button>
              )}
            </header>
            <ul>
              {g.entries.map((e) => (
                <li key={e.id}>
                  <button class={`chat-item ${props.active === e.id ? "on" : ""}`} onClick={() => props.onPick(e.id)}>
                    <span class="chat-item-title">{e.pinned && g.key !== "pinned" && <Icon name="pin" size={12} />} {titleOf(e)}</span>
                    {e.preview && <span class="chat-item-preview">{unicodeMath(e.preview)}</span>}
                    <span class="chat-item-meta">
                      {KINDS[e.kind]} · {dayLabel(e.updated)}
                      {by !== "papers" && Array.isArray(e.focus) && <> · {props.name(e.focus)}</>}
                      {(e.topics ?? []).map((t) => <span key={t} class="chip">{t}</span>)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

type WorkProps = Parameters<typeof ChatsPanel>[0] & {
  byId: Map<string, Paper>;
  name(ids: string[]): string;
  entry?: Entry;
  onNew(s: Start): void;
};

/** A conversation kept, opened again where it stopped. */
function OpenChat(props: WorkProps & { id: string }) {
  const [c, setC] = useState<Conversation | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!props.storage) return;
    loadConversation(props.storage, props.id).then((x) => (x ? setC(x) : setMissing(true)));
  }, [props.id]);

  if (missing) return <p class="muted">This chat could not be read. It may have been deleted on another device.</p>;
  if (!c) return <p class="muted">Opening…</p>;
  const record = (next: Conversation) => {
    setC(next);
    props.onRecord(next);
  };
  return (
    <>
      <ChatHead {...props} c={c} />
      <Engine {...props} resume={c} onRecord={record} />
    </>
  );
}

/** A new chat: Ask, a table, a weighing or a review draft, about the papers given or chosen. */
function NewChat(props: WorkProps & { start: Start }) {
  const [mode, setMode] = useState<Mode>(props.start.mode);
  const [ids, setIds] = useState<string[] | undefined>(props.start.ids);
  const [n, setN] = useState(0);
  const one = mode === "ask" && ids?.length === 1 ? props.byId.get(ids[0]) : undefined;
  const begun = Boolean(props.entry);

  return (
    <>
      {props.entry && <ChatHead {...props} c={props.entry as Conversation} />}
      {!begun && (
        <>
          <div class="tabs" role="tablist">
            {MODES.map(([m, label]) => (
              <button key={m} role="tab" aria-selected={mode === m} class={mode === m ? "on" : ""} onClick={() => { setMode(m); setN(n + 1); }}>{label}</button>
            ))}
          </div>
          {ids?.length ? (
            <p class="chats-about small">
              About <span class="chip" title={ids.map((id) => props.byId.get(id)?.title).join("\n")}>{props.name(ids)}</span>{" "}
              <button class="link small" onClick={() => { setIds(undefined); setN(n + 1); }}>Choose other papers</button>
            </p>
          ) : null}
        </>
      )}
      <Engine key={`${mode}-${n}`} {...props} mode={mode} pick={ids} paper={one} />
    </>
  );
}

/** The workspace for a chat's kind: Ask, Compare, or a chat about one paper. */
function Engine(props: WorkProps & { resume?: Conversation; mode?: Mode; pick?: string[]; paper?: Paper }) {
  const r = props.resume;
  const kind = r?.kind;
  const paper = props.paper ?? (r?.paperId ? props.byId.get(r.paperId) : undefined);
  const ask = (ids: string[]) => props.onNew({ mode: "ask", ids });
  const compare = (ids: string[]) => props.onNew({ mode: "table", ids });

  if (kind === "paper" || kind === "explain" || (!r && paper)) {
    if (!paper) return <p class="muted">The paper this chat was about is no longer in your library.</p>;
    return <PaperChat paper={paper} settings={props.settings} resume={r} pdfOf={props.pdfOf} onRecord={props.onRecord} onOpen={props.onOpen} />;
  }
  if (kind === "table" || kind === "weigh" || kind === "review" || (!r && props.mode && props.mode !== "ask")) {
    return (
      <ComparePanel
        papers={props.papers}
        inView={props.inView}
        viewLabel={props.viewLabel}
        texts={props.texts}
        settings={props.settings}
        start={(kind ?? props.mode) as Tab}
        resume={r}
        pick={props.pick}
        onRecord={props.onRecord}
        onAskAbout={ask}
        onOpen={props.onOpen}
      />
    );
  }
  return (
    <AskPanel
      papers={props.papers}
      inView={props.inView}
      viewLabel={props.viewLabel}
      texts={props.texts}
      unindexed={props.unindexed}
      settings={props.settings}
      onIndex={props.onIndex}
      onAdd={props.onAdd}
      resume={r}
      pick={props.pick}
      onRecord={props.onRecord}
      onCompare={compare}
      onOpen={props.onOpen}
    />
  );
}

/** A chat's name, pin, topics and papers, and what can be done with it. */
function ChatHead(props: WorkProps & { c: Conversation }) {
  const e = props.entry ?? props.c;
  const c = props.c;
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const topics = e.topics ?? [];
  const known = topicsOf(props.entries).filter((t) => !topics.includes(t));
  const ids = (Array.isArray(e.focus) ? e.focus : e.papers).filter((id) => props.byId.has(id));
  const focusLabel = e.focus === "beyond" ? "Beyond the library" : e.focus === "library" || !ids.length ? "Whole library" : props.name(ids);

  function rename(ev: Event) {
    ev.preventDefault();
    const v = new FormData(ev.currentTarget as HTMLFormElement).get("name")?.toString().trim() ?? "";
    props.onOrganize(e.id, { name: v === e.title ? "" : v });
    setRenaming(false);
  }
  function addTopic(ev: Event) {
    ev.preventDefault();
    const v = new FormData(ev.currentTarget as HTMLFormElement).get("topic")?.toString().trim() ?? "";
    if (v && !topics.includes(v)) props.onOrganize(e.id, { topics: [...topics, v] });
    setAdding(false);
  }
  async function copy() {
    const full = props.storage ? (await loadConversation(props.storage, e.id)) ?? c : c;
    const name = (paperId: string, page: number) => sourceLabel({ n: 0, paperId, page, text: "" }, props.byId.get(paperId));
    navigator.clipboard?.writeText(conversationMarkdown({ ...full, title: titleOf(e) }, name)).then(() => setNote("Copied as Markdown."), () => setNote("Could not copy."));
  }

  return (
    <div class="chat-head">
      <div class="chat-head-row">
        {renaming ? (
          <form class="chat-rename" onSubmit={rename}>
            <input name="name" defaultValue={titleOf(e)} aria-label="Name" autoFocus onKeyDown={(ev) => ev.key === "Escape" && (ev.stopPropagation(), setRenaming(false))} />
            <button class="primary small" type="submit">Save</button>
          </form>
        ) : (
          <h3 class="chat-title" onDblClick={() => setRenaming(true)}>{titleOf(e)}</h3>
        )}
        <div class="chat-tools">
          <button class="icon-btn" onClick={() => setRenaming(!renaming)} title="Rename" aria-label="Rename"><Icon name="edit" size={16} /></button>
          <button class={`icon-btn ${e.pinned ? "on" : ""}`} aria-pressed={Boolean(e.pinned)} onClick={() => props.onOrganize(e.id, { pinned: !e.pinned })} title={e.pinned ? "Unpin" : "Pin to the top"} aria-label="Pin">
            <Icon name="pin" size={16} />
          </button>
          <button class="icon-btn" onClick={copy} title="Copy as Markdown, for your notes" aria-label="Copy as Markdown"><Icon name="copy" size={16} /></button>
          <button class="icon-btn" onClick={() => confirm("Delete this chat on every device?") && props.onRemove(e.id)} title="Delete" aria-label="Delete"><Icon name="trash" size={16} /></button>
        </div>
      </div>
      <div class="chat-meta small">
        <span class="muted">{KINDS[e.kind]} · {dayLabel(e.created)} ·</span>
        {ids.length ? (
          ids.length === 1 ? (
            <a href="#" onClick={(ev) => { ev.preventDefault(); props.onOpen(ids[0], c.page ?? 0); }} title={props.byId.get(ids[0])?.title}>{focusLabel}</a>
          ) : (
            <span title={ids.map((id) => props.byId.get(id)?.title).join("\n")}>{focusLabel}</span>
          )
        ) : (
          <span>{focusLabel}</span>
        )}
        {topics.map((t) => (
          <span key={t} class="chip">
            {t}
            <button class="icon-btn" onClick={() => props.onOrganize(e.id, { topics: topics.filter((x) => x !== t) })} aria-label={`Remove topic ${t}`}><Icon name="x" size={11} /></button>
          </span>
        ))}
        {adding ? (
          <form class="chat-topic" onSubmit={addTopic}>
            <input name="topic" list="chat-topics" placeholder="Topic" aria-label="Topic" autoFocus onBlur={(ev) => !ev.currentTarget.value && setAdding(false)} />
            <datalist id="chat-topics">{known.map((t) => <option key={t} value={t} />)}</datalist>
          </form>
        ) : (
          <button class="link small" onClick={() => setAdding(true)}>+ Topic</button>
        )}
      </div>
      {ids.length > 0 && (
        <div class="chat-next small">
          {c.kind !== "table" && ids.length > 1 && <button class="link small" onClick={() => props.onNew({ mode: "table", ids })}><Icon name="table" size={13} /> Table of {papersText(ids.length)}</button>}
          {c.kind !== "weigh" && ids.length > 1 && <button class="link small" onClick={() => props.onNew({ mode: "weigh", ids })}>Where they agree</button>}
          {!(c.kind === "paper" || c.kind === "explain" || c.kind === "ask") && <button class="link small" onClick={() => props.onNew({ mode: "ask", ids })}><Icon name="sparkle" size={13} /> Ask about {ids.length === 1 ? "this paper" : "these"}</button>}
        </div>
      )}
      {note && <p class="message small" role="status">{note}</p>}
    </div>
  );
}
