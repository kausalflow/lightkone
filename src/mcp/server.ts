import type { Paper, PaperDraft, StorageAdapter } from "../core/types";
import { Library } from "../core/library";
import { search } from "../core/search";
import { paperToBibtex } from "../core/bibtex";
import { annotationsPath, parseAnnotations } from "../core/annotations";
import { pagesOf, textPath } from "../core/fulltext";
import { arxiv, arxivId, crossref, doiOf } from "../plugins/lookup";
import { cleanFolder, folderTree, type FolderNode } from "../core/folders";
import { buildGraph, loadCitations, worksById } from "../core/citations";
import { loadExplorations, loadResult, resultPath } from "../core/explore";
import { findInText } from "../core/textsearch";

// Lightkone as an MCP server (Streamable HTTP, JSON responses): Claude, Claude
// Code or any MCP client can search the library, read papers and notes, and
// add or tag papers. It works on the same storage files as the web app.

export const PROTOCOL = "2025-06-18";
const decoder = new TextDecoder();

type Json = Record<string, unknown>;
interface Tool {
  name: string;
  description: string;
  inputSchema: Json;
  annotations?: Json;
  run(args: Json, ctx: Ctx): Promise<string>;
}
interface Ctx {
  storage: StorageAdapter;
  library: Library;
  resolve(id: string): Promise<PaperDraft | null>;
  /** For OpenAlex; tests pass their own. */
  fetch?: typeof fetch;
}

const brief = (p: Paper) => ({
  id: p.id,
  key: p.key,
  title: p.title,
  authors: p.authors.length > 4 ? [...p.authors.slice(0, 3), "et al."] : p.authors,
  year: p.year,
  venue: p.venue,
  tags: p.tags,
  folders: p.folders?.length ? p.folders : undefined,
  starred: p.starred || undefined,
  arxiv: p.arxiv,
  doi: p.doi,
  pdf: Boolean(p.pdf),
});

function find(lib: Library, ref: unknown): Paper {
  const r = String(ref ?? "").trim();
  const p = lib.papers.find((x) => x.id === r || x.key === r || (x.doi && x.doi.toLowerCase() === r.toLowerCase()) || (x.arxiv && x.arxiv === r.replace(/^arxiv:/i, "")));
  if (!p) throw new Error(`No paper "${r}" in the library. Use search_papers to find its id or citation key.`);
  return p;
}

const TEXT_DIR = "lightkone/text/";
/** At most this many full texts are read for one search_full_text call. */
const TEXT_SCAN = 40;

const PAPER = { type: "string", description: "The paper's id or citation key (from search_papers), or its DOI or arXiv id." };

export const tools: Tool[] = [
  {
    name: "search_papers",
    description:
      "Search the researcher's paper library. Words match title, authors, abstract, tags and notes; filters: tag:x author:x year:2020 year:2015-2020 has:pdf has:notes " +
      'in:"Folder/Sub" is:starred is:recent (recently read). ' +
      "An empty query lists the most recently added papers.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }, required: ["query"] },
    annotations: { readOnlyHint: true },
    async run(a, { library }) {
      const found = search(library.papers, String(a.query ?? ""), "added");
      const limit = Math.min(100, Number(a.limit) || 20);
      return JSON.stringify({ total: found.length, papers: found.slice(0, limit).map(brief) }, null, 1);
    },
  },
  {
    name: "get_paper",
    description: "One paper's full record: abstract, the researcher's notes, highlights with their notes, and its BibTeX.",
    inputSchema: { type: "object", properties: { paper: PAPER }, required: ["paper"] },
    annotations: { readOnlyHint: true },
    async run(a, { library, storage }) {
      const p = find(library, a.paper);
      const raw = await storage.read(annotationsPath(p.id)).catch(() => null);
      const highlights = parseAnnotations(raw && decoder.decode(raw), p.id).map((h) => ({ page: h.page, text: h.text, note: h.note }));
      const hasText = Boolean(await storage.read(textPath(p.id)).catch(() => null));
      return JSON.stringify({ ...p, fields: undefined, highlights, full_text_available: hasText, bibtex: paperToBibtex(p) }, null, 1);
    },
  },
  {
    name: "read_paper",
    description:
      "The full text of a paper, extracted from its PDF, with [page N] markers. Long papers can be read a few pages at a time. " +
      "Math is as the PDF's text layer gives it, so equations may be garbled.",
    inputSchema: {
      type: "object",
      properties: { paper: PAPER, from_page: { type: "integer", minimum: 1 }, to_page: { type: "integer", minimum: 1 } },
      required: ["paper"],
    },
    annotations: { readOnlyHint: true },
    async run(a, { library, storage }) {
      const p = find(library, a.paper);
      const raw = await storage.read(textPath(p.id)).catch(() => null);
      if (!raw) {
        const where = p.arxiv ? ` Its arXiv page is https://arxiv.org/abs/${p.arxiv}.` : p.doi ? ` Its DOI is ${p.doi}.` : "";
        return p.pdf
          ? `The text of "${p.title}" has not been extracted yet: open the paper once in Lightkone's reader.${where}`
          : `"${p.title}" has no PDF in the library.${where} The abstract: ${p.abstract ?? "(none)"}`;
      }
      const { text, pages } = pagesOf(decoder.decode(raw), Number(a.from_page) || 1, Number(a.to_page) || Infinity);
      return `"${p.title}" (${pages} pages)\n\n${text}`;
    },
  },
  {
    name: "list_tags",
    description: "All tags and folders in the library, with how many papers are in each (a folder counts the folders inside it).",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    async run(_, { library }) {
      const folders: Record<string, number> = {};
      const walk = (ns: FolderNode[]) => ns.forEach((n) => ((folders[n.path] = n.count), walk(n.children)));
      walk(folderTree(library.papers));
      return JSON.stringify({ tags: Object.fromEntries(library.tagCounts()), folders }, null, 1);
    },
  },
  {
    name: "search_full_text",
    description:
      "Find words inside the papers' full text (every word must occur), with the page and a snippet. " +
      "Only papers whose text Lightkone has extracted are searched. Narrow it with `within`, a search_papers query " +
      '(like "tag:qft" or "year:2018-2024"), to search more of the right papers at once.',
    inputSchema: {
      type: "object",
      properties: {
        words: { type: "string" },
        within: { type: "string", description: "A search_papers query; only papers it finds are searched." },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
      },
      required: ["words"],
    },
    annotations: { readOnlyHint: true },
    async run(a, { library, storage }) {
      const words = String(a.words ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) throw new Error("Give some words to look for.");
      const limit = Math.min(50, Number(a.limit) || 20);
      const stored = new Set((await storage.list(TEXT_DIR).catch(() => [] as string[])).map((k) => k.slice(TEXT_DIR.length, -4)));
      const pool = search(library.papers, String(a.within ?? ""), "added").filter((p) => stored.has(p.id));
      // Each text is one storage read; keep a single call well inside a server's budget.
      const scan = pool.slice(0, TEXT_SCAN);
      const hits: Json[] = [];
      for (let i = 0; i < scan.length && hits.length < limit; i += 8) {
        const batch = await Promise.all(
          scan.slice(i, i + 8).map(async (p) => {
            const raw = await storage.read(textPath(p.id)).catch(() => null);
            const hit = raw && findInText(decoder.decode(raw), words);
            return hit ? { ...brief(p), page: hit.page, snippet: hit.snippet } : null;
          }),
        );
        hits.push(...(batch.filter(Boolean) as Json[]));
      }
      const note =
        pool.length > scan.length
          ? `Searched the ${scan.length} most recently added of ${pool.length} papers with text; narrow it with \`within\` to search the rest.`
          : `Searched ${scan.length} papers with text.`;
      return JSON.stringify({ note, papers: hits.slice(0, limit) }, null, 1);
    },
  },
  {
    name: "get_citations",
    description:
      "How a paper connects to the rest of the library: the library papers it cites and the library papers that cite it, " +
      "from the citation map (references from OpenAlex, fetched when the researcher opens the map in Lightkone).",
    inputSchema: { type: "object", properties: { paper: PAPER }, required: ["paper"] },
    annotations: { readOnlyHint: true },
    async run(a, { library, storage }) {
      const p = find(library, a.paper);
      const store = await loadCitations(storage);
      if (!store.works[p.id]) return `No references for "${p.title}" yet: open the citation map in Lightkone once to fetch them.`;
      const g = buildGraph(library.papers, store);
      const n = g.nodes.get(p.id)!;
      const byId = (id: string) => brief(g.nodes.get(id)!.paper);
      return JSON.stringify({ paper: brief(p), cited_by_count: n.cited || undefined, cites: n.cites.map(byId), cited_by: n.citedBy.map(byId) }, null, 1);
    },
  },
  {
    name: "find_missing_papers",
    description:
      "Works that several papers in the library cite but the library does not have, most shared first: likely gaps in the reading. " +
      "Add one with add_paper by its DOI or arXiv id.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50, default: 15 } } },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(a, { library, storage, fetch: f }) {
      const store = await loadCitations(storage);
      const g = buildGraph(library.papers, store);
      if (!g.known) return "The citation map is empty: open it in Lightkone once to fetch the papers' references.";
      const top = g.missing.slice(0, Math.min(50, Number(a.limit) || 15));
      const works = top.length ? await worksById(top.map((m) => m.oa), { fetch: f }) : new Map();
      const keyOf = (id: string) => g.nodes.get(id)?.paper.key ?? id;
      return JSON.stringify(
        {
          papers_with_references: g.known,
          missing: top.map((m) => {
            const w = works.get(m.oa);
            return { openalex: m.oa, title: w?.title, authors: w?.authors?.slice(0, 3), year: w?.year, doi: w?.doi, arxiv: w?.arxiv, cited_by_library: m.by.map(keyOf) };
          }),
        },
        null,
        1,
      );
    },
  },
  {
    name: "list_branches",
    description:
      "The researcher's kept Branches: citation neighbourhoods grown from chosen papers, a folder or the whole library, " +
      "with the strongest candidates from the last time each was opened in Lightkone. Name one to see more of its candidates.",
    inputSchema: {
      type: "object",
      properties: { branch: { type: "string", description: "A branch's name or id; leave out to list them all." }, limit: { type: "integer", minimum: 1, maximum: 50, default: 10 } },
    },
    annotations: { readOnlyHint: true },
    async run(a, { library, storage }) {
      const { items } = await loadExplorations(storage);
      if (!items.length) return "No Branches kept yet. They are made in Lightkone's citation map, under Branches.";
      const want = String(a.branch ?? "").trim().toLowerCase();
      const chosen = want ? items.filter((b) => b.id === want || b.name.toLowerCase().includes(want)) : items;
      if (!chosen.length) throw new Error(`No branch "${a.branch}". Kept: ${items.map((b) => b.name).join("; ")}`);
      const limit = Math.min(50, Number(a.limit) || (want ? 20 : 5));
      const store = await loadCitations(storage);
      const out = await Promise.all(
        chosen.map(async (b) => {
          const r = await loadResult(storage, resultPath(b.scope ?? "", b.roots), store);
          return {
            id: b.id,
            name: b.name,
            grows_from: b.scope === "library" ? "the whole library" : b.scope?.startsWith("folder:") ? `folder ${b.scope.slice(7)}` : b.roots.map((x) => x.title),
            results_from: r?.at,
            candidates: r
              ? r.candidates.slice(0, limit).map((c) => {
                  const own = c.paperId && library.papers.find((p) => p.id === c.paperId);
                  return {
                    title: c.draft.title,
                    authors: c.draft.authors?.slice(0, 3),
                    year: c.year || undefined,
                    doi: c.draft.doi,
                    arxiv: c.draft.arxiv,
                    cited_by_count: c.cited,
                    in_library: own ? own.key : undefined,
                    cites_roots: c.citesRoots.length || undefined,
                    cited_by_roots: c.citedByRoots.length || undefined,
                    shared_references: c.shared || undefined,
                  };
                })
              : "Not opened yet: open this branch in Lightkone once to read its neighbourhood.",
          };
        }),
      );
      return JSON.stringify(out, null, 1);
    },
  },
  {
    name: "export_bibtex",
    description: "BibTeX for chosen papers, or for every paper a search_papers query finds (up to 500), ready for a .bib file.",
    inputSchema: {
      type: "object",
      properties: { papers: { type: "array", items: PAPER }, query: { type: "string", description: "A search_papers query, used when `papers` is not given." } },
    },
    annotations: { readOnlyHint: true },
    async run(a, { library }) {
      const refs = (a.papers as string[] | undefined) ?? [];
      const chosen = refs.length ? refs.map((r) => find(library, r)) : a.query !== undefined ? search(library.papers, String(a.query), "added").slice(0, 500) : [];
      if (!chosen.length) throw new Error(refs.length || a.query !== undefined ? "No papers matched." : "Give `papers` or a `query`.");
      return chosen.map(paperToBibtex).join("\n\n");
    },
  },
  {
    name: "add_paper",
    description: "Add a paper to the library by DOI, arXiv id, or a link containing either. Metadata comes from Crossref or arXiv. Optionally tag it.",
    inputSchema: {
      type: "object",
      properties: { identifier: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
      required: ["identifier"],
    },
    async run(a, { library, resolve }) {
      const draft = await resolve(String(a.identifier ?? ""));
      if (!draft) throw new Error(`Could not find a paper for "${a.identifier}". Give a DOI or an arXiv id.`);
      draft.tags = [...(draft.tags ?? []), ...((a.tags as string[]) ?? [])];
      const { added, updated } = library.merge([draft]);
      await library.save();
      const p = added[0] ?? updated[0] ?? library.findDuplicate(draft);
      return added.length ? `Added: ${JSON.stringify(p && brief(p))}` : `Already in the library: ${JSON.stringify(p && brief(p))}`;
    },
  },
  {
    name: "tag_papers",
    description: 'Add or remove tags, and put papers into or take them out of folders (paths like "Physics/QFT"), for one or more papers.',
    inputSchema: {
      type: "object",
      properties: {
        papers: { type: "array", items: PAPER, minItems: 1 },
        add: { type: "array", items: { type: "string" } },
        remove: { type: "array", items: { type: "string" } },
        add_folders: { type: "array", items: { type: "string" } },
        remove_folders: { type: "array", items: { type: "string" } },
      },
      required: ["papers"],
    },
    async run(a, { library }) {
      const add = ((a.add as string[]) ?? []).map((t) => t.trim()).filter(Boolean);
      const remove = new Set((a.remove as string[]) ?? []);
      const addF = ((a.add_folders as string[]) ?? []).map(cleanFolder).filter(Boolean);
      const removeF = new Set(((a.remove_folders as string[]) ?? []).map(cleanFolder));
      const done = (a.papers as string[]).map((ref) => {
        const p = find(library, ref);
        library.update(p.id, {
          tags: [...new Set([...p.tags.filter((t) => !remove.has(t)), ...add])],
          folders: [...new Set([...(p.folders ?? []).filter((f) => !removeF.has(f)), ...addF])],
        });
        return `${p.key}: tags ${p.tags.join(", ") || "(none)"}; folders ${p.folders?.join(", ") || "(none)"}`;
      });
      await library.save();
      return done.join("\n");
    },
  },
  {
    name: "add_note",
    description: "Append text to a paper's notes (the free-text notes on the paper, not a highlight).",
    inputSchema: { type: "object", properties: { paper: PAPER, text: { type: "string" } }, required: ["paper", "text"] },
    async run(a, { library }) {
      const p = find(library, a.paper);
      library.update(p.id, { notes: [p.notes, String(a.text ?? "").trim()].filter(Boolean).join("\n\n") });
      await library.save();
      return `Saved to the notes of ${p.key}.`;
    },
  },
];


interface Prompt {
  name: string;
  title: string;
  description: string;
  arguments: { name: string; description: string; required?: boolean }[];
  text(args: Record<string, string>): string;
}

/** Ready-made asks, shown by MCP apps as prompts or slash commands. */
export const prompts: Prompt[] = [
  {
    name: "find_in_library",
    title: "What do I have on…",
    description: "Find the papers in your library on a topic, with what your notes say about them.",
    arguments: [{ name: "topic", description: "The topic, method or question.", required: true }],
    text: (a) =>
      `Find the papers in my Lightkone library about: ${a.topic}\n\n` +
      "Use search_papers with a few different wordings, and search_full_text for terms that may only appear in the body. " +
      "For the most relevant few, use get_paper to see my notes and highlights. Answer with a short list grouped by theme, " +
      "each paper as its citation key, title and year, and one line on why it fits. Say plainly if the library has little on it.",
  },
  {
    name: "cite_draft",
    title: "Cite this draft",
    description: "Suggest citations from your library for a paragraph or section, with BibTeX.",
    arguments: [{ name: "text", description: "The draft text (LaTeX is fine).", required: true }],
    text: (a) =>
      "Suggest citations from my Lightkone library for this draft. For each claim that needs one, search the library " +
      "(search_papers, then search_full_text or read_paper to check the paper really says it). Only cite papers that are in the library. " +
      "Return the draft with \\cite{key} added where they belong, then a short list of claims you could not support, then export_bibtex for the keys you used.\n\n" +
      a.text,
  },
  {
    name: "reading_gaps",
    title: "What am I missing?",
    description: "Papers your library keeps citing but does not have, and the strongest new candidates in your Branches.",
    arguments: [{ name: "focus", description: "Optional: a topic, folder or branch to focus on." }],
    text: (a) =>
      `Look for gaps in my Lightkone library${a.focus ? `, focusing on ${a.focus}` : ""}. ` +
      "Use find_missing_papers for works several of my papers cite that I don't have, and list_branches for the strongest candidates in my kept Branches. " +
      "Pick the ten most worth reading, say in a line each why (which of my papers lead to it), and ask before adding any with add_paper.",
  },
  {
    name: "explain_paper",
    title: "Walk me through a paper",
    description: "Read a paper in your library and explain it at research level, with your own notes and highlights.",
    arguments: [{ name: "paper", description: "Citation key, title words, DOI or arXiv id.", required: true }],
    text: (a) =>
      `Walk me through "${a.paper}" from my Lightkone library. Find it (search_papers if needed), read get_paper for my notes and highlights, ` +
      "then read_paper. Explain the setup, the key steps and assumptions, and the result, at graduate level with the math kept. " +
      "Then use get_citations to say how it connects to the other papers I have.",
  },
];

export async function resolveIdentifier(input: string): Promise<PaperDraft | null> {
  const a = arxivId(input);
  if (a) return arxiv(a);
  const d = doiOf(input);
  return d ? crossref(d) : null;
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Json;
}

const ok = (id: RpcRequest["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: RpcRequest["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Answer one JSON-RPC message. Notifications (no id) get no answer. */
export async function handleRpc(msg: RpcRequest, storage: StorageAdapter, resolve = resolveIdentifier, fetchFn?: typeof fetch): Promise<unknown | null> {
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Invalid request");
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? PROTOCOL);
      return ok(msg.id, {
        protocolVersion: /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : PROTOCOL,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: { name: "lightkone", title: "Lightkone paper library", version: "0.5.1" },
        instructions:
          "This is a researcher's own paper library. Search it before answering questions about papers they have read, " +
          "cite papers by their citation key, and read the full text (read_paper) when the abstract is not enough. " +
          "Ask before adding papers or changing tags and notes unless the researcher asked for it.",
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: tools.map(({ run: _, ...t }) => t) });
    case "prompts/list":
      return ok(msg.id, { prompts: prompts.map(({ text: _, ...p }) => p) });
    case "prompts/get": {
      const prompt = prompts.find((p) => p.name === msg.params?.name);
      if (!prompt) return fail(msg.id, -32602, `Unknown prompt ${String(msg.params?.name)}`);
      const args = (msg.params?.arguments as Record<string, string>) ?? {};
      const lacking = prompt.arguments.filter((x) => x.required && !String(args[x.name] ?? "").trim()).map((x) => x.name);
      if (lacking.length) return fail(msg.id, -32602, `Missing ${lacking.join(", ")}`);
      return ok(msg.id, { description: prompt.description, messages: [{ role: "user", content: { type: "text", text: prompt.text(args) } }] });
    }
    case "tools/call": {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool ${String(msg.params?.name)}`);
      try {
        const library = new Library();
        library.storage = storage;
        await library.load();
        const text = await tool.run((msg.params?.arguments as Json) ?? {}, { storage, library, resolve, fetch: fetchFn });
        return ok(msg.id, { content: [{ type: "text", text }] });
      } catch (e) {
        return ok(msg.id, { content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      return fail(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

/** The HTTP side: POST carries one message or a batch; GET (server-sent events) is not offered. */
export async function handleHttp(request: Request, storage: StorageAdapter, resolve = resolveIdentifier): Promise<Response> {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(fail(null, -32700, "Parse error")), { status: 400, headers });
  }
  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as RpcRequest[];
  const answers = (await Promise.all(messages.map((m) => handleRpc(m, storage, resolve)))).filter((x) => x !== null);
  if (!answers.length) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(batch ? answers : answers[0]), { headers });
}
