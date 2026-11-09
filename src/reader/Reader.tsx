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
import { PdfView, type Cite, type Selected } from "./view";
import type { Source } from "../core/ask";
import { Explain, type Subject } from "./Explain";
import { joinPages, textPath } from "../core/fulltext";
import { Icon } from "../icons";
import { SideChat, type ReaderChatProps } from "./SideChat";
import "./reader.css";

const decoder = new TextDecoder();
const SIDE_KEY = "lightkone.reader.side";
const DOCK_KEY = "lightkone.reader.dock";
const SIZE_KEY = "lightkone.reader.size";
/** Where the side panel snaps on a wide screen. */
type Dock = "right" | "left" | "bottom" | "float";
const DOCKS: readonly Dock[] = ["right", "left", "bottom", "float"];
/** A floating panel's place and size, in px from the top left of the reader's body. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** What the reader's side panel can show; more can join later. */
type Side = "notes" | "chat";

function remembered<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && (!allowed.length || allowed.includes(v)) ? v : fallback;
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

export function Reader(props: { paper: Paper; storage: StorageAdapter; page?: number; quote?: { page: number; text: string }; onClose(): void; onError(msg: string): void; onText?(paperId: string, text: string): void; onRecord?(c: Conversation): void; chat?: ReaderChatProps }) {
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
  // The passages the latest answer in the chat cites, highlighted on the page and stepped through.
  // Opened from a citation elsewhere (Ask, Chats): that passage, shown at once.
  const [cited, setCited] = useState<Source[]>(() => (props.quote ? [{ n: 1, paperId: props.paper.id, ...props.quote }] : []));
  const jumpFirst = useRef(Boolean(props.quote));
  const [cites, setCites] = useState<(Cite & { page: number })[]>([]);
  const [citeAt, setCiteAt] = useState(0);
  const [citesShown, setCitesShown] = useState(true);
  // Where you were reading before jumping to a source, to go back to.
  const [back, setBack] = useState<number | null>(null);
  const pdfBytes = useRef<Uint8Array | null>(null);
  // A marker on the page was tapped: show that source; the latest goCite, as the view keeps the first one given.
  const citeClick = useRef<(n: number) => void>(() => {});
  const loaded = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => view.current?.setDark(dark), [dark]);
  // The pages fit the room left beside the side panel.
  useEffect(() => view.current?.layout(), [sideOpen]);

  // On a wide screen the side panel snaps to the right, left or bottom of the page,
  // and is as wide (or tall) as you drag it; both remembered on this device.
  const [dock, setDock] = useState<Dock>(() => remembered<Dock>(DOCK_KEY, "right", DOCKS));
  const [sizes, setSizes] = useState<Record<Dock, number>>(() => {
    const out = { right: 0, left: 0, bottom: 0, float: 0 };
    for (const d of DOCKS) out[d] = Number(remembered(`${SIZE_KEY}.${d}`, "", [] as string[])) || 0;
    return out;
  });
  const size = sizes[dock];
  const across = dock === "bottom" ? () => innerHeight : () => innerWidth;
  const clamp = (n: number) => Math.round(Math.max(dock === "bottom" ? 160 : 280, Math.min(n, across() - (dock === "bottom" ? 200 : 320))));
  function setSize(n: number, keep = true) {
    setSizes((x) => ({ ...x, [dock]: n }));
    if (keep) remember(`${SIZE_KEY}.${dock}`, n ? String(n) : "");
  }
  // Floating: dragged by its tab bar anywhere over the page, resized from its corner.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(() => {
    try {
      const b = JSON.parse(remembered(`${SIZE_KEY}.float`, "", [] as string[]) || "null") as Box | null;
      return b && [b.x, b.y, b.w, b.h].every(Number.isFinite) ? b : null;
    } catch {
      return null;
    }
  });
  function fit(b: Box): Box {
    const r = bodyRef.current?.getBoundingClientRect();
    const W = r?.width ?? innerWidth;
    const H = r?.height ?? innerHeight;
    const w = Math.max(280, Math.min(b.w, W - 16));
    const h = Math.max(200, Math.min(b.h, H - 16));
    return { w, h, x: Math.max(8, Math.min(b.x, W - w - 8)), y: Math.max(8, Math.min(b.y, H - h - 8)) };
  }
  const floatBox = (): Box => {
    const r = bodyRef.current?.getBoundingClientRect();
    const W = r?.width ?? innerWidth;
    const H = r?.height ?? innerHeight;
    return fit(box ?? { w: 420, h: Math.round(H * 0.7), x: W - 440, y: 24 });
  };
  function dragFloat(e: PointerEvent, how: "move" | "size") {
    if (dock !== "float" || narrow()) return;
    if (how === "move" && (e.target as HTMLElement).closest("button, input, select, textarea, [role=tab]")) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const start = floatBox();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let b = start;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      b = fit(how === "move" ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, w: start.w + dx, h: start.h + dy });
      setBox(b);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      remember(`${SIZE_KEY}.float`, JSON.stringify(b));
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  function snap(d: Dock) {
    setDock(d);
    remember(DOCK_KEY, d);
    requestAnimationFrame(() => view.current?.layout());
  }
  useEffect(() => view.current?.layout(), [dock]);
  function startResize(e: PointerEvent) {
    if (narrow()) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    let n = size;
    const move = (ev: PointerEvent) => {
      n = clamp(dock === "right" ? innerWidth - ev.clientX : dock === "left" ? ev.clientX : innerHeight - ev.clientY);
      setSize(n, false);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (n) setSize(n);
      view.current?.layout();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }
  function nudgeSize(e: KeyboardEvent) {
    const grow = { right: "ArrowLeft", left: "ArrowRight", bottom: "ArrowUp", float: "" }[dock];
    const shrink = { right: "ArrowRight", left: "ArrowLeft", bottom: "ArrowDown", float: "" }[dock];
    if (!grow || (e.key !== grow && e.key !== shrink)) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    setSize(clamp((dock === "bottom" ? box.height : box.width) + (e.key === grow ? 40 : -40)));
    requestAnimationFrame(() => view.current?.layout());
  }

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
    v.onCiteClick = (n) => citeClick.current(n);
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

  // Find each cited passage on its page once the PDF is open.
  const citedKey = cited.map((s) => `${s.n}:${s.page}:${s.text}`).join("|");
  useEffect(() => {
    const v = view.current;
    if (!v || !pages) return;
    let live = true;
    Promise.all(cited.map(async (s) => ({ n: s.n, page: s.page, found: (await v.find(s.page, s.text).catch(() => null)) ?? [] }))).then((cs) => {
      if (!live) return;
      setCites(cs);
      setCiteAt(0);
      setBack(null);
      setCitesShown(true);
      if (jumpFirst.current && cs[0]) {
        jumpFirst.current = false;
        setCiteAt(cs[0].n);
        if (cs[0].found.length) v.scrollToCite(cs[0]);
      }
    });
    return () => {
      live = false;
    };
  }, [citedKey, pages]);
  useEffect(() => view.current?.setCites(citesShown ? cites.filter((c) => c.found.length) : [], citeAt), [cites, citeAt, citesShown, pages]);

  /** Go to one of the answer's sources, remembering where you were. */
  function goCite(n: number) {
    const c = cites.find((x) => x.n === n);
    const v = view.current;
    if (!v) return;
    if (back === null) setBack(v.scroll);
    setCitesShown(true);
    setCiteAt(n);
    if (c?.found.length) v.scrollToCite(c);
    else v.scrollToPage(c?.page ?? cited.find((x) => x.n === n)?.page ?? 1);
    if (narrow()) setTall(false);
  }
  function stepCite(by: number) {
    if (!cites.length) return;
    const i = cites.findIndex((c) => c.n === citeAt);
    // From none shown, next is the first and previous the last.
    const j = i < 0 ? (by > 0 ? 0 : cites.length - 1) : (i + by + cites.length) % cites.length;
    goCite(cites[j].n);
  }
  function goBack() {
    if (back === null || !view.current) return;
    view.current.scroll = back;
    setBack(null);
  }

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

  citeClick.current = (n) => {
    setCiteAt(n);
    if (props.chat) showSide("chat");
  };
  const citePos = cites.findIndex((c) => c.n === citeAt);
  const citeMissing = cites.filter((c) => !c.found.length).length;

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

      <div class={`reader-body dock-${dock}`} ref={bodyRef}>
        <div class="pdf-wrap">
          <div class="pdf-pages" ref={pagesRef}>
            {state === "loading" && <p class="muted center">Opening…</p>}
          </div>
          {cites.length > 0 && citesShown && (
            <div class="cite-bar" role="toolbar" aria-label="Sources of the answer">
              <span class="dot" aria-hidden="true" />
              <span class="label">Sources</span>
              <button class="icon-btn prev" onClick={() => stepCite(-1)} aria-label="Previous source" title="Previous source">
                <Icon name="chevron" />
              </button>
              <span class="count" aria-live="polite">{citePos >= 0 ? `${citePos + 1} / ${cites.length}` : `${cites.length}`}</span>
              <button class="icon-btn" onClick={() => stepCite(1)} aria-label="Next source" title="Next source">
                <Icon name="chevron" />
              </button>
              {citeMissing > 0 && <span class="missing" title="Claude quoted these, but their words could not be found on the page; tapping them opens the page">{citeMissing} not marked</span>}
              {back !== null && (
                <button class="small" onClick={goBack} title="Back to where you were reading">
                  Back
                </button>
              )}
              <button class="icon-btn" onClick={() => setCitesShown(false)} aria-label="Hide the answer's highlights" title="Hide these highlights">
                <Icon name="x" />
              </button>
            </div>
          )}
        </div>

        {sideOpen && (
          <aside
            class={`reader-side ${tall ? "tall" : ""}`}
            style={lift && narrow() ? { bottom: `${lift}px`, maxHeight: `calc(100dvh - ${lift}px - 56px)` } : narrow() ? undefined : dock === "float" ? (({ x, y, w, h }) => ({ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }))(floatBox()) : size ? (dock === "bottom" ? { height: `${clamp(size)}px` } : { width: `${clamp(size)}px` }) : undefined}
            aria-label={side === "chat" ? "Chat about this paper" : "Highlights and notes"}
          >
            <div
              class="side-resize"
              role="separator"
              aria-orientation={dock === "bottom" ? "horizontal" : "vertical"}
              aria-label="Resize the side panel"
              title="Drag to resize"
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={nudgeSize}
              onDblClick={() => { setSize(0); requestAnimationFrame(() => view.current?.layout()); }}
            />
            {dock === "float" && <div class="side-corner" aria-hidden="true" title="Drag to resize" onPointerDown={(e) => dragFloat(e, "size")} />}
            <div class="side-tabs" role="tablist" onPointerDown={(e) => dragFloat(e, "move")}>
              <button role="tab" aria-selected={side === "notes"} class={side === "notes" ? "on" : ""} onClick={() => showSide("notes")}>
                Notes{highlights.length ? <span class="badge">{highlights.length}</span> : ""}
              </button>
              {props.chat && (
                <button role="tab" aria-selected={side === "chat"} class={side === "chat" ? "on" : ""} onClick={() => showSide("chat")}>
                  Chat
                </button>
              )}
              <span class="spacer" />
              <span class="side-snap" role="group" aria-label="Where the panel sits">
                {DOCKS.map((d) => (
                  <button
                    key={d}
                    class={`icon-btn ${dock === d ? "on" : ""}`}
                    aria-pressed={dock === d}
                    aria-label={d === "float" ? "Float over the page" : `Snap to the ${d}`}
                    title={d === "float" ? "Float over the page (drag the tab bar to move it)" : `Snap to the ${d}`}
                    onClick={() => snap(d)}
                  >
                    <Icon name={d === "bottom" ? "dockBottom" : d === "float" ? "window" : "dockRight"} class={d === "left" ? "flip" : ""} />
                  </button>
                ))}
              </span>
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
                onCited={setCited}
                onCite={(s) => goCite(s.n)}
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
