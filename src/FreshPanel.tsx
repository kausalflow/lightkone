import { useEffect, useMemo, useState } from "preact/hooks";
import type { Paper, PaperDraft, StorageAdapter } from "./core/types";
import { digest, dismiss, getPreprints, loadFresh, profileIds, rank, saveFresh, toDraft, topCategories, type FreshStore, type Pick, type Preprint } from "./core/fresh";
import { shortAuthors } from "./core/cite";
import { renderMarkdown } from "./core/markdown";
import { useMath } from "./core/math";
import { appAddress, dullabyBase, nightList } from "./core/night";

const dayName = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
const split = (s: string) => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);

/** Each day's arXiv preprints near your library: add them, or say they're not for you. */
export function FreshPanel(props: {
  papers: Paper[];
  storage: StorageAdapter;
  settings: Record<string, string>;
  hidden?: boolean;
  onOpen(paperId: string, page: number): void;
  onAdd(d: PaperDraft): boolean;
  onClose(): void;
}) {
  const [store, setStore] = useState<FreshStore | null>(null);
  const [preprints, setPreprints] = useState<Preprint[] | null>(null);
  const [status, setStatus] = useState<string | null>("Reading your settings…");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [more, setMore] = useState(false);
  const [done, setDone] = useState<Map<string, "added" | "dismissed">>(new Map());
  const math = useMath();
  // The library as it was on opening, so what is added here stays in the list, marked Added.
  const [opened] = useState(() => [...props.papers]);

  async function fetchFor(s: FreshStore) {
    setError(null);
    try {
      let cats = s.categories;
      if (!cats.length) {
        const ids = profileIds(opened);
        if (!ids.length) {
          setStatus(null);
          setEditing(true);
          return;
        }
        setStatus("Finding the arXiv categories your library is in…");
        cats = topCategories(await getPreprints({ ids }));
        if (!cats.length) {
          setStatus(null);
          setEditing(true);
          return;
        }
        s = { ...s, categories: cats };
        setStore(s);
        saveFresh(props.storage, s).catch(() => {});
      }
      setStatus(`Fetching the newest preprints in ${cats.join(", ")}…`);
      setPreprints(await getPreprints({ cats }));
      setStatus(null);
    } catch (e) {
      setStatus(null);
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    loadFresh(props.storage).then((s) => {
      setStore(s);
      fetchFor(s);
      // Next time, preprints after now are marked new.
      saveFresh(props.storage, { ...s, visited: new Date().toISOString() }).catch(() => {});
    });
  }, []);

  const picks = useMemo(() => (store && preprints ? rank(preprints, opened, store) : []), [store?.keywords.join("|"), store?.dismissed.length, preprints]);
  const days = useMemo(() => digest(picks, { max: more ? 50 : 20 }), [picks, more]);
  const byId = new Map(props.papers.map((p) => [p.id, p]));
  const inline = (text: string) => renderMarkdown(text, math).replace(/^<p>|<\/p>$/g, "");

  function save(s: FreshStore) {
    setStore(s);
    saveFresh(props.storage, s).catch((e) => setError(`Could not save: ${(e as Error).message}`));
  }

  function notForMe(p: Pick) {
    setDone(new Map(done).set(p.preprint.arxiv, "dismissed"));
    // Kept on screen until the list is next drawn, so it can be seen going.
    setTimeout(() => save(dismiss(store!, p.preprint)), 600);
  }

  const dullaby = dullabyBase(props.settings);
  // Dullaby takes the library with each paper; worked out once, not per row.
  const night = useMemo(() => ({ lib: nightList(props.papers), from: appAddress(location.href) }), [props.papers.length]);

  return (
    <div class="overlay" hidden={props.hidden} onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel wide fresh-panel">
        <h2>New on arXiv for you</h2>
        {store && !editing && (
          <p class="muted small">
            {store.categories.length ? `From ${store.categories.join(", ")}` : "No categories yet"}
            {store.keywords.length ? `, lifting ${store.keywords.map((k) => `“${k}”`).join(", ")}` : ""}. Ranked by how close each is to papers in your library.{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setEditing(true); }}>Change</a>
          </p>
        )}
        {store && editing && (
          <Follow
            store={store}
            onSave={(s) => {
              setEditing(false);
              save(s);
              setPreprints(null);
              fetchFor(s);
            }}
            onCancel={store.categories.length ? () => setEditing(false) : undefined}
          />
        )}
        {status && <p class="muted">{status}</p>}
        {error && <p class="error">{error}</p>}
        {preprints && !days.length && !status && <p class="muted">Nothing new near your library in the last few days.</p>}
        {days.map((g) => (
          <section key={g.day} class="fresh-day">
            <h3>{dayName(g.day)}</h3>
            <ul class="candidates">
              {g.picks.map((p) => {
                const x = p.preprint;
                const state = done.get(x.arxiv);
                return (
                  <li key={x.arxiv} class={`fresh-item${state ? ` ${state}` : ""}`}>
                    <div class="cand-title">
                      {p.fresh && <span class="badge">New</span>}
                      <span dangerouslySetInnerHTML={{ __html: inline(x.title) }} />
                    </div>
                    <div class="muted small">{[shortAuthors(x.authors), x.categories[0], x.arxiv].filter(Boolean).join(" · ")}</div>
                    {p.near.length > 0 && (
                      <div class="small near">
                        Near{" "}
                        {p.near.slice(0, 2).map((id, i) => (
                          <span key={id}>
                            {i > 0 && " and "}
                            <a href="#" onClick={(e) => { e.preventDefault(); props.onOpen(id, 0); }}>{byId.get(id)?.title ?? "a paper"}</a>
                          </span>
                        ))}
                      </div>
                    )}
                    {p.keywords.length > 0 && <div class="small">{p.keywords.map((k) => <span key={k} class="chip">{k}</span>)}</div>}
                    <details class="small">
                      <summary>Abstract</summary>
                      <div class="abstract" dangerouslySetInnerHTML={{ __html: renderMarkdown(x.abstract, math) }} />
                    </details>
                    <div class="row left">
                      <button
                        class={state === "added" ? "" : "primary"}
                        disabled={Boolean(state)}
                        onClick={() => props.onAdd(toDraft(x)) && setDone(new Map(done).set(x.arxiv, "added"))}
                      >
                        {state === "added" ? "Added" : "Add"}
                      </button>
                      <button disabled={Boolean(state)} onClick={() => notForMe(p)}>{state === "dismissed" ? "Not shown again" : "Not for me"}</button>
                      <a class="button" href={`https://arxiv.org/abs/${x.arxiv}`} target="_blank" rel="noopener">arXiv</a>
                      <a class="button" href={`${dullaby}#${new URLSearchParams({ arxiv: x.arxiv, title: x.title, ...night })}`} target="_blank" rel="noopener">Read at night</a>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        {days.length > 0 && !more && picks.length > 20 && (
          <p><a href="#" onClick={(e) => { e.preventDefault(); setMore(true); }}>Show more</a></p>
        )}
        <div class="row">
          <button onClick={props.onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Follow(props: { store: FreshStore; onSave(s: FreshStore): void; onCancel?: () => void }) {
  const [cats, setCats] = useState(props.store.categories.join(", "));
  const [words, setWords] = useState(props.store.keywords.join(", "));
  return (
    <form
      class="fresh-follow"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave({ ...props.store, categories: split(cats), keywords: split(words) });
      }}
    >
      <label class="field">
        <span>arXiv categories</span>
        <input value={cats} onInput={(e) => setCats(e.currentTarget.value)} placeholder="astro-ph.CO, hep-th, stat.ML" />
        <span class="muted small">Up to 8. Left empty, they are guessed from your library's arXiv papers.</span>
      </label>
      <label class="field">
        <span>Keywords that lift a preprint (optional)</span>
        <input value={words} onInput={(e) => setWords(e.currentTarget.value)} placeholder="dark energy, conformal prediction" />
      </label>
      <div class="row left">
        <button class="primary" type="submit">Show preprints</button>
        {props.onCancel && <button type="button" onClick={props.onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
