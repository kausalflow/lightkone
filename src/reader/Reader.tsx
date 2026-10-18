import { useEffect, useRef, useState } from "preact/hooks";
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
import "./reader.css";

const decoder = new TextDecoder();
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Reader(props: { paper: Paper; storage: StorageAdapter; onClose(): void; onError(msg: string): void }) {
  const { paper, storage } = props;
  const pagesRef = useRef<HTMLDivElement>(null);
  const view = useRef<PdfView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [pages, setPages] = useState(0);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [selection, setSelection] = useState<Selected | null>(null);
  const [open, setOpen] = useState<Highlight | null>(null);
  const [noteText, setNoteText] = useState("");
  const [list, setList] = useState(false);
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("lightkone.reader.dark") === "1";
    } catch {
      return false;
    }
  });
  const loaded = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);

  // Open the PDF and its annotations.
  useEffect(() => {
    const v = new PdfView(pagesRef.current!);
    view.current = v;
    v.onHighlightClick = (h) => {
      setOpen(h);
      setNoteText(h.note ?? "");
      setSelection(null);
    };
    (async () => {
      try {
        const [bytes, notes] = await Promise.all([storage.read(paper.pdf!), storage.read(annotationsPath(paper.id)).catch(() => null)]);
        if (!bytes) throw new Error("The PDF is missing from storage.");
        const hs = parseAnnotations(notes && decoder.decode(notes), paper.id);
        setPages(await v.open(bytes));
        setHighlights(hs);
        loaded.current = true;
        setState("ready");
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
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (open ? setOpen(null) : props.onClose());
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open]);

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
        <button class="ghost" onClick={props.onClose} aria-label="Close reader">←</button>
        <span class="reader-title">{paper.title}</span>
        <button class="ghost" onClick={() => view.current?.setZoom((view.current?.zoom ?? 1) - 0.25)} aria-label="Zoom out">−</button>
        <button class="ghost" onClick={() => view.current?.setZoom((view.current?.zoom ?? 1) + 0.25)} aria-label="Zoom in">+</button>
        <button class="ghost" onClick={toggleDark} title="Dark pages for reading at night" aria-pressed={dark}>Dark</button>
        <button class="ghost" onClick={() => setList(!list)} aria-pressed={list}>
          Notes{highlights.length ? ` ${highlights.length}` : ""}
        </button>
      </header>

      <div class="reader-body">
        <div class="pdf-pages" ref={pagesRef}>
          {state === "loading" && <p class="muted center">Opening…</p>}
        </div>

        {list && (
          <aside class="reader-notes">
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
                  <button class="note-jump" onClick={() => { view.current?.scrollTo(h); if (innerWidth < 860) setList(false); }}>
                    <span class="note-text">{h.text}</span>
                    {h.note && <span class="note-note">{h.note}</span>}
                    <span class="muted small">p. {h.page}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>

      {selection && !open && (
        <div class="reader-sheet" onMouseDown={(e) => e.preventDefault()}>
          <button class="primary" onClick={() => addHighlight(false)}>Highlight</button>
          <button onClick={() => addHighlight(true)}>Highlight + note</button>
        </div>
      )}
      {open && (
        <div class="reader-sheet note-sheet">
          <p class="quote">{open.text}</p>
          <textarea rows={3} placeholder="Your note" value={noteText} autoFocus onInput={(e) => setNoteText(e.currentTarget.value)} />
          <div class="row">
            <button class="primary" onClick={saveNote}>Save</button>
            <button class="ghost" onClick={() => setOpen(null)}>Cancel</button>
            <button class="link danger" onClick={removeHighlight}>Delete highlight</button>
          </div>
        </div>
      )}
    </div>
  );
}
