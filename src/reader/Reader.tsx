import { useEffect, useRef, useState } from "preact/hooks";
import type { Conversation } from "../core/history";
import type { Paper, StorageAdapter } from "../core/types";
import {
  annotationsPath,
  annotationsToMarkdown,
  mergeRects,
  parseAnnotations,
  serializeAnnotations,
  sortHighlights,
  type Highlight,
} from "../core/annotations";
import { PdfView, type Selected } from "./view";
import { Explain, type Subject } from "./Explain";
import { joinPages, textPath } from "../core/fulltext";
import { Icon } from "../icons";
import { SideChat, type ReaderChatProps } from "./SideChat";
import "./reader.css";

const decoder = new TextDecoder();
const SIDE_KEY = "lightkone.reader.side";
/** What the reader's side panel can show; more can join later. */
type Side = "notes" | "chat";

function remembered<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode: fine for this session
  }
}

/** On a phone the side panel is a sheet over the lower part of the page; it moves up above the keyboard. */
function useKeyboardLift(): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setLift(Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)));
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    return () => {
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
    };
  }, []);
  return lift;
}
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Reader(props: { paper: Paper; storage: StorageAdapter; page?: number; onClose(): void; onError(msg: string): void; onText?(paperId: string, text: string): void; onRecord?(c: Conversation): void; chat?: ReaderChatProps }) {
  const { paper, storage } = props;
  const pagesRef = useRef<HTMLDivElement>(null);
  const view = useRef<PdfView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [pages, setPages] = useState(0);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selection, setSelection] = useState<Selected | null>(null);
  const [open, setOpen] = useState<Highlight | null>(null);
  const [noteText, setNoteText] = useState("");
  // The side panel: closed, or open on Notes or Chat.
  const [sideOpen, setSideOpen] = useState(false);
  const [side, setSide] = useState<Side>(() => (props.chat ? remembered<Side>(SIDE_KEY, "notes", ["notes", "chat"]) : "notes"));
  const [tall, setTall] = useState(false);
  const [seed, setSeed] = useState<{ text: string; n: number } | undefined>(undefined);
  const lift = useKeyboardLift();
  const narrow = () => innerWidth < 860;
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("lightkone.reader.dark") === "1";
    } catch {
      return false;
    }
  });
  const [explaining, setExplaining] = useState<Subject | null>(null);
  const pdfBytes = useRef<Uint8Array | null>(null);
  const loaded = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => view.current?.setDark(dark), [dark]);
  // The pages fit the room left beside the side panel.
  useEffect(() => view.current?.layout(), [sideOpen]);

  function showSide(s: Side) {
    setSide(s);
    setSideOpen(true);
    remember(SIDE_KEY, s);
  }

  // Open the PDF and its annotations.
  useEffect(() => {
    const v = new PdfView(pagesRef.current!);
    view.current = v;
    v.setDark(dark);
    v.onHighlightClick = (h) => {
      setOpen(h);
      setNoteText(h.note ?? "");
      setSelection(null);
    };
    (async () => {
      try {
        const [bytes, notes] = await Promise.all([storage.read(paper.pdf!), storage.read(annotationsPath(paper.id)).catch(() => null)]);
        if (!bytes) throw new Error("The PDF is missing from storage.");
        pdfBytes.current = bytes;
        const hs = parseAnnotations(notes && decoder.decode(notes), paper.id);
        setPages(await v.open(bytes));
        setHighlights(hs);
        loaded.current = true;
        setState("ready");
        if (props.page) requestAnimationFrame(() => v.scrollToPage(props.page!));
        // Keep the text next to the PDF once, for search and for AI tools reading the library.
        if (!(await storage.read(textPath(paper.id)).catch(() => null))) {
          v.allText()
            .then(async (pages) => {
              if (!pages.some((s) => s.trim())) return;
              const text = joinPages(pages);
              await storage.write(textPath(paper.id), text, "text/plain; charset=utf-8");
              props.onText?.(paper.id, text);
            })
            .catch(() => {}); // closed meanwhile, or offline: next time
        }
      } catch (e) {
        setState("failed");
        props.onError(`Could not open the PDF: ${(e as Error).message}`);
      }
    })();
    const onResize = () => v.layout();
    addEventListener("resize", onResize);
    return () => {
      removeEventListener("resize", onResize);
      v.destroy();
    };
  }, [paper.id, paper.pdf]);

  useEffect(() => view.current?.setHighlights(highlights), [highlights, pages]);

  // Save highlights shortly after each change.
  useEffect(() => {
    if (!loaded.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      storage.write(annotationsPath(paper.id), serializeAnnotations(paper.id, highlights), "application/json").catch((e) =>
        props.onError(`Could not save highlights: ${(e as Error).message}`),
      );
    }, 800);
  }, [highlights]);

  // Offer "Highlight" while text is selected.
  useEffect(() => {
    let t: number | undefined;
    const onChange = () => {
      clearTimeout(t);
      t = window.setTimeout(() => setSelection(view.current?.selection() ?? null), 150);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (explaining ? setExplaining(null) : open ? setOpen(null) : props.onClose());
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, explaining]);

  function addHighlight(withNote: boolean) {
    if (!selection) return;
    const h: Highlight = { id: newId(), page: selection.page, rects: mergeRects(selection.rects), text: selection.text, created: new Date().toISOString() };
    setHighlights(sortHighlights([...highlights, h]));
    document.getSelection()?.removeAllRanges();
    setSelection(null);
    if (withNote) {
      setOpen(h);
      setNoteText("");
    }
  }

  /** Ask about a passage in the chat beside the page. */
  function askAbout(s: { page: number; text: string }) {
    const quote = s.text.replace(/\s+/g, " ").trim();
    setSeed({ text: `About this passage (p. ${s.page}): “${quote.length > 600 ? `${quote.slice(0, 600)}…` : quote}”\n`, n: (seed?.n ?? 0) + 1 });
    showSide("chat");
    document.getSelection()?.removeAllRanges();
    setSelection(null);
    setOpen(null);
  }

  function explain(s: { page: number; rects: Selected["rects"]; text: string }) {
    setExplaining({ page: s.page, rects: s.rects, text: s.text, image: view.current?.snapshot(s.page, s.rects) ?? null });
    document.getSelection()?.removeAllRanges();
    setSelection(null);
    setOpen(null);
  }

  /** Keep an explanation: as the note of the highlight it came from, or on a new highlight. */
  function saveExplanation(answer: string) {
    if (!explaining) return;
    const rects = mergeRects(explaining.rects);
    const same = highlights.find((h) => h.page === explaining.page && h.text === explaining.text);
    if (same) {
      setHighlights(highlights.map((h) => (h === same ? { ...h, note: [h.note, answer].filter(Boolean).join("\n\n") } : h)));
    } else {
      setHighlights(sortHighlights([...highlights, { id: newId(), page: explaining.page, rects, text: explaining.text, note: answer, created: new Date().toISOString() }]));
    }
    setExplaining(null);
  }

  function saveNote() {
    if (!open) return;
    setHighlights(highlights.map((h) => (h.id === open.id ? { ...h, note: noteText.trim() || undefined } : h)));
    setOpen(null);
  }

  function removeHighlight() {
    if (!open) return;
    setHighlights(highlights.filter((h) => h.id !== open.id));
    setOpen(null);
  }

  function toggleDark() {
    setDark(!dark);
    try {
      localStorage.setItem("lightkone.reader.dark", dark ? "0" : "1");
    } catch {
      // private mode: fine for this session
    }
  }

  return (
    <div class={`reader ${dark ? "dark" : ""}`} role="dialog" aria-label={`Reading ${paper.title}`}>
      <header class="reader-bar">
        <button class="icon-btn" onClick={props.onClose} aria-label="Close reader" title="Close reader">
          <Icon name="back" />
        </button>
        <span class="reader-title">{paper.title}</span>
        <button class="icon-btn" onClick={() => view.current?.setZoom((view.current?.zoom ?? 1) - 0.25)} aria-label="Zoom out" title="Zoom out">
          <Icon name="minus" />
        </button>
        <button class="icon-btn" onClick={() => view.current?.setZoom((view.current?.zoom ?? 1) + 0.25)} aria-label="Zoom in" title="Zoom in">
          <Icon name="plus" />
        </button>
        <button class={`icon-btn ${dark ? "pressed" : ""}`} onClick={toggleDark} title="Dark pages for reading at night" aria-label="Dark pages" aria-pressed={dark}>
          <Icon name="moon" />
        </button>
        {props.chat ? (
          <button
            class={`icon-btn side-btn ${sideOpen ? "pressed" : ""}`}
            onClick={() => setSideOpen(!sideOpen)}
            aria-pressed={sideOpen}
            aria-label="Notes and chat"
            title="Notes and chat beside the paper"
          >
            <Icon name="dockRight" />
            {highlights.length ? <span class="badge">{highlights.length}</span> : ""}
          </button>
        ) : (
          <button class={`ghost notes-btn ${sideOpen ? "pressed" : ""}`} onClick={() => setSideOpen(!sideOpen)} aria-pressed={sideOpen}>
            Notes{highlights.length ? <span class="badge">{highlights.length}</span> : ""}
          </button>
        )}
      </header>

      <div class="reader-body">
        <div class="pdf-pages" ref={pagesRef}>
          {state === "loading" && <p class="muted center">Opening…</p>}
        </div>

        {sideOpen && (
          <aside
            class={`reader-side ${tall ? "tall" : ""}`}
            style={lift && narrow() ? { bottom: `${lift}px`, maxHeight: `calc(100dvh - ${lift}px - 56px)` } : undefined}
            aria-label={side === "chat" ? "Chat about this paper" : "Highlights and notes"}
          >
            <div class="side-tabs" role="tablist">
              <button role="tab" aria-selected={side === "notes"} class={side === "notes" ? "on" : ""} onClick={() => showSide("notes")}>
                Notes{highlights.length ? <span class="badge">{highlights.length}</span> : ""}
              </button>
              {props.chat && (
                <button role="tab" aria-selected={side === "chat"} class={side === "chat" ? "on" : ""} onClick={() => showSide("chat")}>
                  Chat
                </button>
              )}
              <span class="spacer" />
              <button class="icon-btn side-grow" onClick={() => setTall(!tall)} aria-label={tall ? "Show more of the page" : "Make the panel taller"} title={tall ? "Show more of the page" : "Taller"}>
                <Icon name="chevron" class={tall ? "down" : "up"} />
              </button>
              <button class="icon-btn" onClick={() => setSideOpen(false)} aria-label="Close the side panel" title="Close">
                <Icon name="x" />
              </button>
            </div>
            {side === "notes" || !props.chat ? (
              <div class="reader-notes">
            <div class="row">
              <button class="small" disabled={!highlights.length} onClick={() => download(`${paper.key}.md`, annotationsToMarkdown(paper, highlights))}>
                Export as Markdown
              </button>
              <button class="small" disabled={!highlights.length} onClick={() => navigator.clipboard?.writeText(annotationsToMarkdown(paper, highlights))}>
                Copy
              </button>
            </div>
            {!highlights.length && <p class="muted small">Select text on a page, then tap Highlight.</p>}
            <ul>
              {highlights.map((h) => (
                <li key={h.id}>
                  <button class="note-jump" onClick={() => { view.current?.scrollTo(h); if (narrow()) setTall(false); }}>
                    <span class="note-text">{h.text}</span>
                    {h.note && <span class="note-note">{h.note}</span>}
                    <span class="muted small">p. {h.page}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
            ) : (
              <SideChat
                key={paper.id}
                {...props.chat}
                paper={paper}
                pdf={() => pdfBytes.current}
                seed={seed}
                autoFocus={!narrow()}
                onPage={(n) => { view.current?.scrollToPage(n); if (narrow()) setTall(false); }}
              />
            )}
          </aside>
        )}
      </div>

      {selection && !open && !explaining && (
        <div class="reader-sheet select-sheet" onMouseDown={(e) => e.preventDefault()}>
          <button class="primary" onClick={() => addHighlight(false)}>Highlight</button>
          <button onClick={() => addHighlight(true)}>Highlight + note</button>
          <button onClick={() => explain(selection)} title="Claude explains this in the context of the paper">Explain</button>
          {props.chat && <button onClick={() => askAbout(selection)} title="Ask about this passage in the chat beside the paper">Ask</button>}
        </div>
      )}
      {explaining && <Explain paper={paper} pdf={pdfBytes.current} subject={explaining} onClose={() => setExplaining(null)} onSave={saveExplanation} onRecord={props.onRecord} />}
      {open && (
        <div class="reader-sheet note-sheet">
          <p class="quote">{open.text}</p>
          <textarea rows={3} placeholder="Your note" value={noteText} autoFocus onInput={(e) => setNoteText(e.currentTarget.value)} />
          <div class="row">
            <button class="primary" onClick={saveNote}>Save</button>
            <button class="ghost" onClick={() => setOpen(null)}>Cancel</button>
            <button class="ghost" onClick={() => explain(open)}>Explain</button>
            {props.chat && <button class="ghost" onClick={() => askAbout(open)}>Ask</button>}
            <button class="link danger" onClick={removeHighlight}>Delete highlight</button>
          </div>
        </div>
      )}
    </div>
  );
}
