import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Paper, PaperDraft } from "./core/types";
import { linkCitations, retrieve, sourceLabel, sourcesPrompt, type Source } from "./core/ask";
import { inLibrary, outsideOf, searchLiterature, type Outside } from "./core/literature";
import { newConversationId, type Conversation } from "./core/history";
import { firstPaper, saveScope, scoped, startScope, type Scope } from "./core/scope";
import { ScopePicker } from "./ScopePicker";
import { MentionBox, QuestionText } from "./MentionBox";
import { mentionedPassages, mentionsAsNames, mentionsIn } from "./core/mentions";
import { renderMarkdown } from "./core/markdown";
import { useMath } from "./core/math";
import { askLibrary, askWholePdfs, type LibraryTurn, type WholeMaterial } from "./plugins/claude";
import { citedAnswer, wholeSet, WHOLE_BYTES, WHOLE_MAX, type Doc } from "./core/wholepdf";
import { Icon } from "./icons";
import { SavedNote } from "./SavedNote";

/**
 * Ask a question across the library, or a folder, tag or papers picked from
 * it. Passages are found here, in the browser, from the papers' texts and
 * abstracts; Claude answers from them and every citation opens the paper at
 * its page. Beyond the library, OpenAlex finds published papers and Claude
 * answers from their abstracts; any of them can be added in one tap.
 */
export function AskPanel(props: {
  papers: Paper[];
  inView: Paper[];
  viewLabel: string;
  texts: Map<string, string>;
  unindexed: number;
  settings: Record<string, string>;
  /** Open a paper at a page, with the cited passage highlighted when given. */
  onOpen(paperId: string, page: number, quote?: string): void;
  onIndex(): void;
  onAdd(d: PaperDraft): boolean;
  /** A conversation from Chats to carry on. */
  resume?: Conversation;
  /** Papers to ask about, chosen elsewhere (a chat, a comparison table). */
  pick?: string[];
  /** Keep the conversation in Chats, after each answer. */
  onRecord(c: Conversation): void;
  /** Compare the papers an answer cites. */
  onCompare(ids: string[]): void;
  /** A paper's PDF from storage, so a few papers can be read whole. */
  pdfOf?(p: Paper): Promise<Uint8Array | null>;
}) {
  const r = props.resume;
  const [scope, setScope] = useState<Scope>(() =>
    startScope({ kept: r?.scope, keptPapers: r?.papers, pick: props.pick, tool: "ask", first: () => firstPaper(props.papers, props.inView) }),
  );
  const [outside, setOutside] = useState<Map<string, Outside>>(() => new Map((r?.outside ?? []).map((o) => [o.id, outsideOf(o.id, o.draft, o.cited)])));
  const [added, setAdded] = useState<Set<string>>(new Set());
  const literature = scope.kind === "literature";
  const [turns, setTurns] = useState<LibraryTurn[]>(() => (r?.turns as LibraryTurn[]) ?? []);
  const [sources, setSources] = useState<Source[]>(() => r?.sources ?? []);
  const conv = useRef<{ id: string; created: string } | null>(r ? { id: r.id, created: r.created } : null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const math = useMath();
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map<string, Paper>([...props.papers.map((p) => [p.id, p] as const), ...outside]), [props.papers, outside]);
  const hasKey = Boolean(props.settings["claude.apiKey"]);
  // The last answer, when it was a saved one (the same question on the same passages or PDFs); and how to ask afresh.
  const [saved, setSaved] = useState<string | null>(null);
  const again = useRef<(() => void) | null>(null);
  const chosen = useMemo(() => scoped(props.papers, scope, props.inView), [props.papers, scope, props.inView]);
  const unread = chosen.filter((p) => p.pdf && !props.texts.has(p.id)).length;
  // A few papers with PDFs are read whole, unless that is turned off.
  const [whole, setWhole] = useState(() => {
    try {
      return localStorage.getItem(WHOLE_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const canWhole = Boolean(props.pdfOf) && !literature && wholeSet(chosen) !== null;
  const readingWhole = turns.length ? Boolean(turns[0].docs) : canWhole && whole;
  const pdfs = useRef(new Map<string, Uint8Array | null>());

  function pickWhole(on: boolean) {
    setWhole(on);
    try {
      localStorage.setItem(WHOLE_KEY, on ? "on" : "off");
    } catch {
      // Remembered for this visit only.
    }
  }

  /** The PDFs of the papers read whole, loaded once. */
  async function load(ids: string[]): Promise<Map<string, WholeMaterial>> {
    const out = new Map<string, WholeMaterial>();
    for (const id of ids) {
      const p = props.papers.find((x) => x.id === id);
      if (!p) continue;
      if (!pdfs.current.has(id)) pdfs.current.set(id, p.pdf && props.pdfOf ? await props.pdfOf(p).catch(() => null) : null);
      out.set(id, { paper: p, pdf: pdfs.current.get(id) });
    }
    return out;
  }

  /** Ask about papers read whole: the first question picks them; later ones can name more. */
  async function askWhole(q: string, named: Paper[]): Promise<boolean> {
    const had = turns.flatMap((t) => t.docs ?? []);
    let docs: Doc[];
    if (!turns.length) {
      const set = wholeSet(chosen, named);
      if (!set) return false;
      const material = await load(set.map((p) => p.id));
      const bytes = [...material.values()].reduce((n, m) => n + (m.pdf?.length ?? 0), 0);
      if (bytes > WHOLE_BYTES || [...material.values()].some((m) => !m.pdf)) return false;
      docs = set.map((p) => ({ paperId: p.id, kind: "pdf" }));
    } else {
      const fresh = named.filter((p) => !had.some((d) => d.paperId === p.id));
      let room = WHOLE_MAX - had.filter((d) => d.kind === "pdf").length;
      docs = fresh.map((p) => ({ paperId: p.id, kind: p.pdf && room-- > 0 ? "pdf" : "abstract" }));
    }
    const all = [...had, ...docs];
    const material = await load(all.map((d) => d.paperId));
    const next: LibraryTurn[] = [...turns, { role: "user", text: q, docs: docs.length ? docs : undefined }];
    const base = sources;
    setQuestion("");
    const run = async (fresh: boolean) => {
      setTurns(next);
      setSources(base);
      setSaved(null);
      setError(null);
      setStreaming("");
      abort.current = new AbortController();
      try {
        const sent = next.map((t) => (t.role === "user" ? { ...t, text: mentionsAsNames(t.text, props.papers) } : t));
        const show = (blocks: Parameters<typeof citedAnswer>[0]) => {
          const r = citedAnswer(blocks, all, base);
          setSources([...base, ...r.added]);
          setStreaming(r.text);
        };
        let at: string | undefined;
        const { blocks, cut } = await askWholePdfs(props.settings, sent, material, show, abort.current.signal, { fresh, onSaved: (a) => (at = a) });
        const r = citedAnswer(blocks, all, base);
        const answer = cut ? `${r.text}\n\n(The answer was cut off at the length limit.)` : r.text;
        const allSources = [...base, ...r.added];
        const done: LibraryTurn[] = [...next, { role: "assistant", text: answer }];
        setSources(allSources);
        setTurns(done);
        setSaved(at ?? null);
        again.current = () => run(true);
        // Asked before, and kept in Chats then.
        if (!(at && next.length === 1)) record(done, allSources, outside);
      } catch (err) {
        if (abort.current.signal.aborted) return true;
        const status = (err as { status?: number }).status;
        if (!turns.length && (status === 400 || status === 413)) {
          // Too many pages or bytes for one request: give the question back to ask from passages.
          setTurns([]);
          setSources(base);
          setQuestion(q);
          setError(`Claude could not take these PDFs whole (${(err as Error).message}). Untick “Read the whole PDFs” to ask from passages instead.`);
        } else setError((err as Error).message);
      } finally {
        setStreaming(null);
      }
    };
    await run(false);
    return true;
  }

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [turns.length, streaming]);

  async function ask(e: Event) {
    e.preventDefault();
    const q = question.trim();
    if (!q || streaming !== null) return;
    // Passages already given to Claude are not sent again; new ones continue the numbering.
    const seen = new Set(sources.map((s) => `${s.paperId}:${s.page}:${s.text.slice(0, 60)}`));
    // Papers named with [[key]] are read whatever the search over the rest finds.
    const named = mentionsIn(q, props.papers);
    const words = (t: string) => t.replace(/\[\[[^\]\n]+\]\]/g, " ");
    const query = words(turns.length ? `${q} ${turns[0].text}` : q);
    let candidates: Source[];
    let more = outside;
    setError(null);
    if (readingWhole || (!turns.length && canWhole && whole)) {
      setStreaming("");
      if (await askWhole(q, named)) return;
      setStreaming(null);
    }
    if (literature) {
      setStreaming("");
      try {
        const works = await searchLiterature(query, { key: props.settings["related.openalexKey"] || undefined });
        more = new Map([...outside, ...works.map((w) => [w.id, w] as const)]);
        candidates = works.map((w, i) => ({ n: i + 1, paperId: w.id, page: 0, text: [w.title, w.abstract].filter(Boolean).join("\n\n") }));
      } catch (err) {
        setStreaming(null);
        setError((err as Error).message);
        return;
      }
    } else {
      candidates = retrieve(chosen, props.texts, query);
    }
    if (named.length) {
      const own = mentionedPassages(named, props.texts, query);
      const key = (s: Source) => `${s.paperId}:${s.page}:${s.text.slice(0, 60)}`;
      const have = new Set(own.map(key));
      candidates = [...own, ...candidates.filter((s) => !have.has(key(s)))];
    }
    const found = candidates
      .filter((s) => !seen.has(`${s.paperId}:${s.page}:${s.text.slice(0, 60)}`))
      .map((s, i) => ({ ...s, n: sources.length + i + 1 }));
    if (!turns.length && !found.length) {
      setStreaming(null);
      setError(
        literature
          ? "OpenAlex found no papers with an abstract for those words. Try other terms."
          : !chosen.length && !named.length
            ? "Add a paper for Claude to read first, or type [[ to name one."
            : "None of the chosen papers mention those words. Try other terms, or add more papers.",
      );
      return;
    }
    setOutside(more);
    const byIdNow = new Map<string, Paper>([...byId, ...more]);
    const all = [...sources, ...found];
    const next: LibraryTurn[] = [...turns, { role: "user", text: q, sources: found.length ? sourcesPrompt(found, byIdNow) : undefined }];
    setSources(all);
    setQuestion("");
    const run = async (fresh: boolean) => {
      setTurns(next);
      setSaved(null);
      setError(null);
      setStreaming("");
      abort.current = new AbortController();
      try {
        // Claude reads each [[key]] as the paper's name, with its key.
        const sent = next.map((t) => (t.role === "user" ? { ...t, text: mentionsAsNames(t.text, props.papers) } : t));
        let at: string | undefined;
        const answer = await askLibrary(props.settings, sent, setStreaming, abort.current.signal, literature ? "literature" : "library", { fresh, onSaved: (a) => (at = a) });
        const done: LibraryTurn[] = [...next, { role: "assistant", text: answer }];
        setTurns(done);
        setSaved(at ?? null);
        again.current = () => run(true);
        // Asked before, and kept in Chats then.
        if (!(at && next.length === 1)) record(done, all, more);
      } catch (err) {
        if (!abort.current.signal.aborted) setError((err as Error).message);
      } finally {
        setStreaming(null);
      }
    };
    await run(false);
  }

  const label = (n: number) => {
    const s = sources[n - 1];
    return s ? sourceLabel(s, byId.get(s.paperId)) : null;
  };
  const render = (md: string) => linkCitations(renderMarkdown(md, math), label);

  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest<HTMLElement>("a.src");
    if (!a) return;
    e.preventDefault();
    const s = sources[Number(a.dataset.src) - 1];
    if (!s) return;
    const far = outside.get(s.paperId);
    const own = far ? inLibrary(far.draft, props.papers) : undefined;
    if (far && !own) {
      const link = far.doi ? `https://doi.org/${far.doi}` : far.url;
      if (link) window.open(link, "_blank", "noopener");
    } else props.onOpen(own?.id ?? s.paperId, own ? 0 : s.page, own || !s.page ? undefined : s.text);
  }

  function record(done: LibraryTurn[], all: Source[], far: Map<string, Outside>) {
    const now = new Date().toISOString();
    conv.current ??= { id: newConversationId(), created: now };
    // Library papers it drew on, and found papers it cited, so Chats can list them.
    const cites = new Set(done.filter((t) => t.role === "assistant").flatMap((t) => citedNumbers(t.text)));
    const named = new Set(done.filter((t) => t.role === "user").flatMap((t) => mentionsIn(t.text, props.papers).map((p) => p.id)));
    for (const t of done) for (const d of t.docs ?? []) named.add(d.paperId);
    const used = all.filter((s) => cites.has(s.n) || named.has(s.paperId));
    props.onRecord({
      id: conv.current.id,
      kind: literature ? "beyond" : "ask",
      title: mentionsAsNames(done[0].text, props.papers, false),
      created: conv.current.created,
      updated: now,
      papers: [...new Set([...used.map((s) => s.paperId), ...done.flatMap((t) => (t.docs ?? []).map((d) => d.paperId))].filter((id) => !far.has(id)))],
      preview: "",
      turns: done,
      sources: all,
      outside: [...far.values()].filter((o) => used.some((s) => s.paperId === o.id)).map((o) => ({ id: o.id, draft: o.draft, cited: o.cited })),
      scope,
    });
  }

  function pickScope(s: Scope) {
    setScope(s);
    saveScope("ask", s);
  }

  function add(p: Outside) {
    if (props.onAdd(p.draft)) setAdded(new Set([...added, p.id]));
  }

  // The papers each answer drew on, for a list under it.
  const cited = (md: string) => {
    const ns = new Set(citedNumbers(md));
    const ids = [...new Set([...ns].map((n) => sources[n - 1]?.paperId).filter(Boolean))] as string[];
    return ids.map((id) => byId.get(id)).filter(Boolean) as Paper[];
  };

  return (
    <div class="work ask-panel" aria-label={literature ? "Ask beyond your library" : "Ask your library"} onClick={onClick}>
        {!turns.length && (
          <ScopePicker papers={props.papers} value={scope} onChange={pickScope} literature />
        )}
        {!turns.length && literature && (
          <p class="muted">
            OpenAlex searches published papers for the words of your question, and Claude answers from their abstracts with a citation for each point.
            Add any paper it cites to your library in one tap.
          </p>
        )}
        {!turns.length && !literature && (
          <p class="muted">
            Claude answers from the papers you add and cites the page each point comes from.
            {" "}Type [[ to name a paper; it is read whatever else is found.
            {canWhole && (
              <label class="check ask-whole">
                <input type="checkbox" checked={whole} onChange={(e) => pickWhole(e.currentTarget.checked)} />
                <span>
                  Read the whole PDFs ({chosen.length} {chosen.length > 1 ? "papers" : "paper"}), so Claude can use figures, tables and equations.
                  {" "}<span class="muted small">Up to {WHOLE_MAX} papers. It costs more than passages; follow-ups reuse the PDFs from the cache.</span>
                </span>
              </label>
            )}
            {!readingWhole && unread > 0 && (
              <>
                {" "}{unread} PDF{unread > 1 ? "s haven't" : " hasn't"} been read yet, so only {unread > 1 ? "their" : "its"} abstract counts.{" "}
                <button class="link" onClick={props.onIndex}>Read them now</button>
              </>
            )}
          </p>
        )}
        {!hasKey && <p class="error">Add your Anthropic API key under Settings → Claude first.</p>}
        <div class="ask-turns">
          {turns.map((t, i) =>
            t.role === "user" ? (
              <p key={i} class="ask-q"><QuestionText text={t.text} papers={byId} /></p>
            ) : (
              <div key={i}>
                <div class="answer" dangerouslySetInnerHTML={{ __html: render(t.text) }} />
                {cited(t.text).length > 0 && (
                  <ul class="ask-cited">
                    {cited(t.text).map((p) => {
                      const far = outside.get(p.id);
                      const own = far ? inLibrary(far.draft, props.papers) : p;
                      return (
                        <li key={p.id}>
                          {own ? (
                            <a href="#" onClick={(e) => { e.preventDefault(); props.onOpen(own.id, 0); }}>{p.title}</a>
                          ) : (
                            <a href={far!.doi ? `https://doi.org/${far!.doi}` : far!.url} target="_blank" rel="noopener">{p.title}</a>
                          )}
                          {p.year ? <span class="muted"> {p.year}</span> : null}
                          {far && (own || added.has(p.id) ? (
                            <span class="muted small"> · in your library</span>
                          ) : (
                            <> · <button class="link small" onClick={() => add(far)}>Add</button></>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {i === turns.length - 1 && cited(t.text).filter((p) => !outside.has(p.id)).length > 1 && (
                  <button class="link small" onClick={() => props.onCompare(cited(t.text).filter((p) => !outside.has(p.id)).map((p) => p.id))}>
                    Compare these {cited(t.text).filter((p) => !outside.has(p.id)).length} papers in a table
                  </button>
                )}
              </div>
            ),
          )}
          {saved && streaming === null && <SavedNote at={saved} onAgain={() => again.current?.()} disabled={!hasKey} />}
          {streaming !== null && (
            <div class="answer" aria-live="polite" dangerouslySetInnerHTML={{ __html: streaming ? render(streaming) : `<p class="muted">${readingWhole ? "Reading the PDFs…" : "Reading the passages…"}</p>` }} />
          )}
          {error && <p class="error">{error}</p>}
          <div ref={bottom} />
        </div>
        <form class="ask-form" onSubmit={ask}>
          <MentionBox
            value={question}
            papers={props.papers}
            autoFocus
            placeholder={turns.length ? "Ask a follow-up; [[ adds a paper" : literature ? "What bounds exist on the sum of neutrino masses from cosmology?" : "Which papers bound the neutrino mass, and how? [[ adds a paper"}
            onInput={setQuestion}
            onSubmit={ask}
          />
          <div class="row">
            {streaming !== null ? (
              <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
            ) : (
              <button class="primary" type="submit" disabled={!question.trim() || !hasKey}>Ask</button>
            )}
            {turns.length > 0 && streaming === null && (
              <button type="button" onClick={() => { setTurns([]); setSources([]); setOutside(new Map()); setError(null); setSaved(null); conv.current = null; }}>New question</button>
            )}
          </div>
        </form>
    </div>
  );
}

const WHOLE_KEY = "lightkone.ask.whole";

/** The source numbers an answer cites: [3], [2, 5]. */
function citedNumbers(md: string): number[] {
  return [...md.matchAll(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g)].flatMap((m) => m[1].split(/\s*[,;]\s*/).map(Number));
}
