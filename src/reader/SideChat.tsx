import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper, StorageAdapter } from "../core/types";
import { chatsAbout, chatSize, dayLabel, isLong, loadConversation, titleOf, type Conversation, type Entry, type Organize } from "../core/history";

export { chatsAbout };
import { PaperChat } from "../PaperChat";
import { Icon } from "../icons";
import type { Source } from "../core/ask";

/** What the reader's Chat tab needs from the app: the kept chats and where they live. */
export interface ReaderChatProps {
  /** Every kept conversation (the index). */
  entries: Entry[];
  /** Where conversations are kept: the library's storage, or this browser for shared and read-only libraries. */
  history: StorageAdapter | null;
  papers: Paper[];
  texts: Map<string, string>;
  settings: Record<string, string>;
  onRecord(c: Conversation): void;
  /** Rename a chat (or pin it, or give it topics). */
  onOrganize(id: string, change: Organize): void;
  /** Open the full Chats panel, on one chat or on this paper's chats. */
  onChats(at: { open?: string; paperId?: string }): void;
  /** A citation to another paper was tapped. */
  onOpenPaper(paperId: string, page: number, quote?: string): void;
}

/**
 * The reader's Chat tab: a chat about the open paper beside its pages. It
 * carries on the latest chat about the paper, or starts one; either way it is
 * kept with the other chats, grouped under the paper.
 */
export function SideChat(props: ReaderChatProps & {
  paper: Paper;
  pdf(): Uint8Array | null;
  /** Scroll the open paper to a page. */
  onPage(page: number): void;
  /** Text to put in the question box (a passage asked about); n changes for each new one. */
  seed?: { text: string; n: number };
  autoFocus?: boolean;
  /** The passages of the paper the latest answer cites, to highlight. */
  onCited?(sources: Source[]): void;
  /** A citation to a passage of the paper was tapped. */
  onCite?(source: Source): void;
}) {
  const mine = useMemo(() => chatsAbout(props.entries, props.paper.id), [props.entries, props.paper.id]);
  // "new", or the id of the chat shown. The latest chat about the paper to begin with.
  const [current, setCurrent] = useState<string>(() => mine[0]?.id ?? "new");
  // Changes only when you switch chats, so recording a new chat doesn't restart it.
  const [n, setN] = useState(0);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [state, setState] = useState<"ready" | "loading" | "missing">(current === "new" ? "ready" : "loading");

  // The passage asked about goes to the chat on screen, not to the next one picked.
  const [seed, setSeed] = useState(props.seed);
  useEffect(() => setSeed(props.seed), [props.seed?.n]);

  function pick(id: string, keepSeed = false) {
    if (!keepSeed) setSeed(undefined);
    setNaming(null);
    pendingName.current = undefined;
    chosenNew.current = id === "new" && !keepSeed;
    started.current = false;
    setCurrent(id);
    setConv(null);
    setState(id === "new" ? "ready" : "loading");
    setN((x) => x + 1);
  }

  useEffect(() => {
    if (current === "new" || conv?.id === current) return;
    if (!props.history) return setState("missing");
    let live = true;
    loadConversation(props.history, current).then(
      (c) => live && (c ? (setConv(c), setState("ready")) : setState("missing")),
      () => live && setState("missing"),
    );
    return () => {
      live = false;
    };
  }, [current, n]);

  // A summary or an explanation joined this paper's running chat: show it, unless Claude is answering here.
  const busy = useRef(false);
  const fresh = mine.find((e) => e.id === current);
  useEffect(() => {
    if (busy.current) return;
    // Only when there was no chat to show: a new chat you started stays yours.
    if (current === "new" && !chosenNew.current && !started.current && mine[0]) return pick(mine[0].id, true);
    if (fresh && conv && fresh.updated > conv.updated) {
      setConv(null);
      setState("loading");
      setN((x) => x + 1);
    }
  }, [fresh?.updated, mine[0]?.id]);
  const started = useRef(false);
  const chosenNew = useRef(false);

  // Naming: the chat shown, or the new one before its first answer.
  const [naming, setNaming] = useState<string | null>(null);
  // The list of this paper's chats, open under the picker.
  const [listing, setListing] = useState(false);
  const pendingName = useRef<string | undefined>(undefined);
  // Chats whose length was noted and waved on, this session.
  const [waved, setWaved] = useState<Set<string>>(() => new Set());

  function rename(e: Event) {
    e.preventDefault();
    const name = (naming ?? "").trim();
    setNaming(null);
    if (current === "new" || !conv) {
      pendingName.current = name || undefined;
      return;
    }
    props.onOrganize(current, { name: name || undefined });
    setConv({ ...conv, name: name || undefined });
  }

  function record(c: Conversation) {
    started.current = true;
    if (pendingName.current && !c.name) c = { ...c, name: pendingName.current };
    pendingName.current = undefined;
    props.onRecord(c);
    setConv(c);
    setCurrent(c.id);
  }

  const known = current !== "new" && !mine.some((e) => e.id === current) && conv ? [{ id: conv.id, title: conv.title, updated: conv.updated } as Entry] : [];
  const options = [...known, ...mine];
  const shown = mine.find((e) => e.id === current) ?? (conv ? (conv as Entry) : undefined);
  const nameNow = current === "new" ? pendingName.current ?? "" : shown ? titleOf(shown) : "";
  const size = conv && current !== "new" ? chatSize(conv.turns) : null;
  const long = size && isLong(size) && !waved.has(current) ? size : null;

  return (
    <div class="side-chat">
      <div class="side-chat-bar">
        {naming !== null ? (
          <form class="side-chat-name" onSubmit={rename}>
            <input
              value={naming}
              autoFocus
              aria-label="Name of this chat"
              placeholder="Name this chat"
              onInput={(e) => setNaming(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setNaming(null))}
            />
            <button class="small primary" type="submit">Save</button>
          </form>
        ) : (
          <>
            <button
              type="button"
              class="side-chat-pick"
              aria-haspopup="listbox"
              aria-expanded={listing}
              title="Switch chat"
              onClick={() => setListing(!listing)}
            >
              <span class="side-chat-pick-name">{current === "new" ? pendingName.current || "New chat" : nameNow || "Chat"}</span>
              <Icon name="chevron" class="down" size={14} />
            </button>
            <button class="icon-btn" title="Name this chat" aria-label="Name this chat" onClick={() => setNaming(nameNow)}>
              <Icon name="edit" />
            </button>
          </>
        )}
        <button class="icon-btn" title="New chat about this paper" aria-label="New chat" onClick={() => pick("new")}>
          <Icon name="plus" />
        </button>
        <button
          class="icon-btn"
          title="Open in Chats: rename, pin, add other papers"
          aria-label="Open in Chats"
          onClick={() => props.onChats(current === "new" ? { paperId: props.paper.id } : { open: current })}
        >
          <Icon name="chat" />
        </button>
      </div>
      {listing && (
        <ul class="side-chat-list" role="listbox" aria-label="Chats about this paper">
          <li role="option" aria-selected={current === "new"} class={current === "new" ? "on" : ""} onClick={() => { setListing(false); if (current !== "new") pick("new"); }}>
            <span class="side-chat-item-title"><Icon name="plus" size={14} /> New chat</span>
          </li>
          {options.map((e) => (
            <li key={e.id} role="option" aria-selected={e.id === current} class={e.id === current ? "on" : ""} onClick={() => { setListing(false); if (e.id !== current) pick(e.id); }}>
              <span class="side-chat-item-title">{titleOf(e)}</span>
              <span class="muted small">{dayLabel(e.updated)}{e.preview ? ` · ${e.preview.slice(0, 90)}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
      {state === "loading" && <p class="muted small">Opening…</p>}
      {state === "missing" && <p class="muted small">This chat could not be read. It may have been deleted on another device.</p>}
      {state === "ready" && (
        <PaperChat
          key={n}
          paper={props.paper}
          papers={props.papers}
          texts={props.texts}
          settings={props.settings}
          resume={current === "new" ? undefined : conv ?? undefined}
          seed={seed}
          autoFocus={props.autoFocus}
          pdfOf={async () => props.pdf()}
          onRecord={record}
          onBusy={(b) => (busy.current = b)}
          onCited={props.onCited}
          onCite={props.onCite}
          notice={
            long && (
              <div class="side-chat-long" role="status">
                <p class="small">
                  This chat is getting long: {long.messages} messages, about {long.tokens.toLocaleString()} tokens of text sent again with each
                  question (the PDF is cached). A new chat costs less and keeps Claude on the point.
                </p>
                <div class="row">
                  <button type="button" class="small primary" onClick={() => pick("new")}>New chat</button>
                  <button type="button" class="small ghost" onClick={() => setWaved(new Set([...waved, current]))}>Keep going</button>
                </div>
              </div>
            )
          }
          onOpen={(id, page, quote) => (id === props.paper.id ? props.onPage(page) : props.onOpenPaper(id, page, quote))}
        />
      )}
    </div>
  );
}
