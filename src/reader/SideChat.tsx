import { useEffect, useMemo, useState } from "preact/hooks";
import type { Paper, StorageAdapter } from "../core/types";
import { dayLabel, loadConversation, titleOf, type Conversation, type Entry } from "../core/history";
import { PaperChat } from "../PaperChat";
import { Icon } from "../icons";

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
  /** Open the full Chats panel, on one chat or on this paper's chats. */
  onChats(at: { open?: string; paperId?: string }): void;
  /** A citation to another paper was tapped. */
  onOpenPaper(paperId: string, page: number): void;
}

/** The chats about one paper, newest first: those started from it, and explanations of its passages. */
export function chatsAbout(entries: Entry[], paperId: string): Entry[] {
  return entries
    .filter((e) => (e.kind === "paper" || e.kind === "explain") && e.papers[0] === paperId)
    .sort((a, b) => b.updated.localeCompare(a.updated));
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

  function pick(id: string) {
    setSeed(undefined);
    setCurrent(id);
    setConv(null);
    setState(id === "new" ? "ready" : "loading");
    setN(n + 1);
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

  function record(c: Conversation) {
    props.onRecord(c);
    setConv(c);
    setCurrent(c.id);
  }

  const known = current !== "new" && !mine.some((e) => e.id === current) && conv ? [{ id: conv.id, title: conv.title, updated: conv.updated } as Entry] : [];
  const options = [...known, ...mine];

  return (
    <div class="side-chat">
      <div class="side-chat-bar">
        <select aria-label="Chat about this paper" value={current} onChange={(e) => pick(e.currentTarget.value)}>
          <option value="new">New chat</option>
          {options.map((e) => (
            <option key={e.id} value={e.id}>
              {titleOf(e).slice(0, 70)} · {dayLabel(e.updated)}
            </option>
          ))}
        </select>
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
          onOpen={(id, page) => (id === props.paper.id ? props.onPage(page) : props.onOpenPaper(id, page))}
        />
      )}
    </div>
  );
}
