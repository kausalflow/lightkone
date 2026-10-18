import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper, StorageAdapter } from "./core/types";
import { indexEquations, loadEquations, prepareEquations, saveEquations, searchEquations, toIndex, type EquationStore } from "./core/equations";
import { shortAuthors } from "./core/cite";
import { useMath } from "./core/math";

/** Paste an equation in LaTeX; find the papers in the library that have it. */
export function EquationPanel(props: { papers: Paper[]; storage: StorageAdapter; hidden?: boolean; onOpen(paperId: string, page: number): void; onClose(): void }) {
  const [store, setStore] = useState<EquationStore | null>(null);
  const [query, setQuery] = useState("");
  const [typed, setTyped] = useState("");
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The search index is brought up to date in the background, a few papers at a time.
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [, redraw] = useState(0);
  const stop = useRef<AbortController | null>(null);
  const math = useMath();

  useEffect(() => {
    loadEquations(props.storage).then(
      async (s) => {
        setStore(s);
        await prepareEquations(s, (d, t) => t > 200 && setPreparing(`Getting ${t} papers' equations ready to search: ${d}…`));
        setPreparing(null);
        setReady(true);
      },
      (e) => setError((e as Error).message),
    );
    return () => stop.current?.abort();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQuery(typed), 250);
    return () => clearTimeout(t);
  }, [typed]);

  const left = store ? toIndex(props.papers, store).length : 0;
  const read = store ? Object.values(store.papers).filter((p) => p.equations.length).length : 0;
  const hits = useMemo(() => (store && ready && query.trim() ? searchEquations(store, query) : []), [store, ready, query, progress?.[0]]);
  const byId = new Map(props.papers.map((p) => [p.id, p]));

  async function readAll() {
    if (!store) return;
    setError(null);
    stop.current = new AbortController();
    setProgress([0, left]);
    try {
      await indexEquations(props.papers, store, {
        signal: stop.current.signal,
        onProgress: (d, t) => setProgress([d, t]),
        onBatch: () => saveEquations(props.storage, store),
      });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
      await saveEquations(props.storage, store).catch(() => {});
    }
    setProgress(null);
    redraw((n) => n + 1);
  }

  return (
    <div class="overlay" hidden={props.hidden} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel wide equation-panel">
        <h2>Search by equation</h2>
        <p class="muted">
          Paste an equation in LaTeX. It is found however it was spaced or braced, and also with its letters renamed. The equations come from the LaTeX
          source of the arXiv papers in your library.
        </p>
        {store && (
          <div class="row left eq-index">
            <span class="small muted">
              {read} paper{read === 1 ? "" : "s"} with equations read
              {left ? `; ${left} arXiv paper${left === 1 ? "" : "s"} not yet read` : ""}.
            </span>
            {progress ? (
              <>
                <span class="small">Reading {progress[0]} of {progress[1]}…</span>
                <button class="small" onClick={() => stop.current?.abort()}>Stop</button>
              </>
            ) : (
              left > 0 && <button class="small primary" onClick={readAll}>Read equations from arXiv</button>
            )}
          </div>
        )}
        {left > 50 && !progress && <p class="small muted">arXiv asks to be read gently, so this goes one paper at a time. It can be stopped and picked up later.</p>}
        {error && <p class="error">{error}</p>}
        {preparing && <p class="small muted">{preparing}</p>}
        <textarea class="eq-query" rows={3} spellcheck={false} autocapitalize="off" value={typed} placeholder="\mathrm{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V" onInput={(e) => setTyped(e.currentTarget.value)} />
        {typed.trim() && <div class="eq-preview" dangerouslySetInnerHTML={{ __html: math(typed, true) }} />}
        {query.trim() && store && ready && !hits.length && <p class="muted">{read ? "No equation like it in your papers." : "Read the equations first."}</p>}
        <ul class="eq-hits">
          {hits.map((h, i) => {
            const p = byId.get(h.paperId);
            return (
              <li key={i}>
                <div class="eq-math" dangerouslySetInnerHTML={{ __html: math(h.equation, true) }} />
                <div class="small">
                  <a href="#" onClick={(e) => { e.preventDefault(); props.onOpen(h.paperId, 0); }}>{p?.title ?? h.arxiv}</a>
                  <span class="muted">
                    {" "}· {[p && shortAuthors(p.authors), p?.year].filter(Boolean).join(" ")}
                    {h.renamed ? " · the same form, other letters" : h.score < 0.85 ? " · close" : ""}
                  </span>{" "}
                  · <a href={`https://arxiv.org/abs/${h.arxiv}`} target="_blank" rel="noopener">arXiv</a>
                </div>
              </li>
            );
          })}
        </ul>
        <div class="row">
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
