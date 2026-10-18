import type { Paper, PaperDraft, StorageAdapter } from "../core/types";
import { Library } from "../core/library";
import { search } from "../core/search";
import { paperToBibtex } from "../core/bibtex";
import { annotationsPath, parseAnnotations } from "../core/annotations";
import { pagesOf, textPath } from "../core/fulltext";
import { arxiv, arxivId, crossref, doiOf } from "../plugins/lookup";

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
}

const brief = (p: Paper) => ({
  id: p.id,
  key: p.key,
  title: p.title,
  authors: p.authors.length > 4 ? [...p.authors.slice(0, 3), "et al."] : p.authors,
  year: p.year,
  venue: p.venue,
  tags: p.tags,
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

const PAPER = { type: "string", description: "The paper's id or citation key (from search_papers), or its DOI or arXiv id." };

export const tools: Tool[] = [
  {
    name: "search_papers",
    description:
      "Search the researcher's paper library. Words match title, authors, abstract, tags and notes; filters: tag:x author:x year:2020 year:2015-2020 has:pdf has:notes. " +
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
    description: "All tags in the library with how many papers carry each.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    async run(_, { library }) {
      return JSON.stringify(Object.fromEntries(library.tagCounts()), null, 1);
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
    description: "Add and/or remove tags on one or more papers.",
    inputSchema: {
      type: "object",
      properties: {
        papers: { type: "array", items: PAPER, minItems: 1 },
        add: { type: "array", items: { type: "string" } },
        remove: { type: "array", items: { type: "string" } },
      },
      required: ["papers"],
    },
    async run(a, { library }) {
      const add = ((a.add as string[]) ?? []).map((t) => t.trim()).filter(Boolean);
      const remove = new Set((a.remove as string[]) ?? []);
      const done = (a.papers as string[]).map((ref) => {
        const p = find(library, ref);
        library.update(p.id, { tags: [...new Set([...p.tags.filter((t) => !remove.has(t)), ...add])] });
        return `${p.key}: ${p.tags.join(", ") || "(no tags)"}`;
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
export async function handleRpc(msg: RpcRequest, storage: StorageAdapter, resolve = resolveIdentifier): Promise<unknown | null> {
  if (msg?.jsonrpc !== "2.0" || typeof msg.method !== "string") return fail(msg?.id, -32600, "Invalid request");
  if (msg.id === undefined) return null;
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? PROTOCOL);
      return ok(msg.id, {
        protocolVersion: /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "lightkone", title: "Lightkone paper library", version: "0.2.0" },
        instructions:
          "This is a researcher's own paper library. Search it before answering questions about papers they have read, " +
          "cite papers by their citation key, and read the full text (read_paper) when the abstract is not enough.",
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: tools.map(({ run: _, ...t }) => t) });
    case "tools/call": {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(msg.id, -32602, `Unknown tool ${String(msg.params?.name)}`);
      try {
        const library = new Library();
        library.storage = storage;
        await library.load();
        const text = await tool.run((msg.params?.arguments as Json) ?? {}, { storage, library, resolve });
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
