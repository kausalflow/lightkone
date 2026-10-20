import { useEffect, useMemo, useState } from "preact/hooks";
import type { Paper, StorageAdapter } from "../core/types";
import { renderMarkdown } from "../core/markdown";
import { useMath } from "../core/math";
import { Icon } from "../icons";
import "./reader.css";

// A saved web page: its Markdown copy as a quiet reading view, or the page as
// it was saved. The saved HTML is shown in a sandbox with no scripts, so it can
// only draw itself, never reach the app or the library.

const decoder = new TextDecoder();

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The saved HTML with its links and images resolved against where it came from, and links opening outside. */
export function sandboxedHtml(html: string, url: string): string {
  const base = `<base href="${url.replace(/"/g, "&quot;")}" target="_blank">`;
  const cleaned = html.replace(/<base\b[^>]*>/gi, "");
  return /<head[^>]*>/i.test(cleaned) ? cleaned.replace(/<head[^>]*>/i, (h) => `${h}${base}`) : `${base}${cleaned}`;
}

export function PageReader(props: { paper: Paper; storage: StorageAdapter; onClose(): void; onError(msg: string): void }) {
  const { paper, storage } = props;
  const math = useMath();
  const [md, setMd] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [view, setView] = useState<"reading" | "original">("reading");
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("lightkone.reader.dark") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!paper.markdown) return;
    storage
      .read(paper.markdown)
      .then((b) => (b ? setMd(decoder.decode(b)) : Promise.reject(new Error("the saved copy is missing"))))
      .catch((e) => {
        props.onError(`Could not open the saved page: ${(e as Error).message}`);
        props.onClose();
      });
  }, [paper.markdown]);

  useEffect(() => {
    if (view !== "original" || html !== null || !paper.html) return;
    storage.read(paper.html).then((b) => setHtml(b ? decoder.decode(b) : ""), () => setHtml(""));
  }, [view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const rendered = useMemo(() => (md === null ? "" : renderMarkdown(md, math, { levels: true })), [md, math]);

  function toggleDark() {
    setDark(!dark);
    try {
      localStorage.setItem("lightkone.reader.dark", dark ? "0" : "1");
    } catch {
      // private mode: fine for this session
    }
  }

  return (
    <div class={`reader page-reader ${dark ? "dark" : ""}`} role="dialog" aria-label={`Reading ${paper.title}`}>
      <header class="reader-bar">
        <button class="icon-btn" onClick={props.onClose} aria-label="Close reader" title="Close reader">
          <Icon name="back" />
        </button>
        <span class="reader-title">{paper.title}</span>
        <button class={`icon-btn ${dark ? "pressed" : ""}`} onClick={toggleDark} title="Dark page for reading at night" aria-label="Dark page" aria-pressed={dark}>
          <Icon name="moon" />
        </button>
        <button class="icon-btn" disabled={md === null} onClick={() => md && navigator.clipboard?.writeText(md)} aria-label="Copy the Markdown" title="Copy the Markdown">
          <Icon name="copy" />
        </button>
        <button class="icon-btn" disabled={md === null} onClick={() => md && download(`${paper.key}.md`, md)} aria-label="Download the Markdown" title="Download the Markdown">
          <Icon name="download" />
        </button>
      </header>
      {paper.html && (
        <div class="page-views" role="tablist">
          <button role="tab" class={view === "reading" ? "on" : ""} aria-selected={view === "reading"} onClick={() => setView("reading")}>Reading view</button>
          <button role="tab" class={view === "original" ? "on" : ""} aria-selected={view === "original"} onClick={() => setView("original")}>Saved page</button>
        </div>
      )}
      <div class="reader-body">
        {view === "reading" ? (
          <article class="page-text" dangerouslySetInnerHTML={{ __html: md === null ? '<p class="muted">Opening…</p>' : rendered }} />
        ) : html === null ? (
          <p class="muted center">Opening…</p>
        ) : (
          <iframe
            class="page-original"
            title={`${paper.title}, as saved`}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerpolicy="no-referrer"
            srcdoc={html ? sandboxedHtml(html, paper.url ?? "about:blank") : "<p>The saved page is missing.</p>"}
          />
        )}
      </div>
    </div>
  );
}
