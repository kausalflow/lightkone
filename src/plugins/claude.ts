import type Anthropic from "@anthropic-ai/sdk";
import type { ActionContext, LightkonePlugin, Paper, PaperDraft } from "../core/types";
import { lookups } from "../core/plugins";
import { loadSettings } from "../core/settings";

// AI on a paper with your own Anthropic API key. The key stays in this
// browser and requests go straight to the Anthropic API. When the PDF is in
// Lightkone's storage, Claude reads the whole paper, otherwise the abstract.

const DEFAULT_MODEL = "claude-opus-5-5";
const MAX_PDF_BYTES = 30 * 1024 * 1024;

const SYSTEM =
  "You help a researcher work with papers in their library. They are at graduate level or beyond: " +
  "be precise, keep the mathematics, skip hype and motivation they already know. " +
  "Say clearly when you only have the abstract and not the full text.";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function describe(p: Paper): string {
  return [
    `Title: ${p.title}`,
    p.authors.length && `Authors: ${p.authors.join("; ")}`,
    p.year && `Year: ${p.year}`,
    p.venue && `Venue: ${p.venue}`,
    p.arxiv && `arXiv: ${p.arxiv}`,
    p.doi && `DOI: ${p.doi}`,
    p.tags.length && `Tags: ${p.tags.join(", ")}`,
    p.abstract && `Abstract: ${p.abstract}`,
    p.notes && `The researcher's notes: ${p.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function clientFor(settings: Record<string, string>) {
  const apiKey = settings["claude.apiKey"];
  if (!apiKey) throw new Error("Add your Anthropic API key under Settings → Claude first.");
  // Loaded on first use so the SDK does not slow down opening the library.
  const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
  return new AnthropicClient({ apiKey, dangerouslyAllowBrowser: true });
}

const textOf = (content: Anthropic.Beta.BetaContentBlock[]) =>
  content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

async function askClaude(p: Paper, ctx: ActionContext, instruction: string): Promise<string> {
  const client = await clientFor(ctx.settings);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (p.pdf && ctx.storage) {
    const bytes = await ctx.storage.read(p.pdf);
    if (bytes && bytes.length <= MAX_PDF_BYTES) {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) } });
    }
  }
  content.push({ type: "text", text: `${describe(p)}\n\n${instruction}` });

  const response = await client.beta.messages.create({
    model: ctx.settings["claude.model"] || DEFAULT_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "medium" },
    // On a policy decline, let the API retry on a suitable model instead of failing.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."}`);
  }
  const text = textOf(response.content);
  return response.stop_reason === "max_tokens" ? `${text}\n\n(The answer was cut off at the length limit.)` : text;
}

const FIND =
  "Identify the one research paper the researcher means, using web search and by fetching the page if they gave a link. " +
  "Reply with only a JSON object, no other text: " +
  '{"found": true, "title": "", "authors": ["Surname, Given"], "year": 2017, "venue": "", "doi": "", "arxiv": "", "url": "", "abstract": ""}. ' +
  'Leave a field empty when you are not sure of it; never guess a DOI. If you cannot tell which paper is meant, reply {"found": false}.';

interface Found {
  found?: boolean;
  title?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxiv?: string;
  url?: string;
  abstract?: string;
}

/** The JSON object in Claude's reply, tolerating a code fence or a stray sentence around it. */
export function parseFound(text: string): Found | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Find a paper from a link without a DOI, or from a description, by asking Claude to search. */
async function findPaper(input: string): Promise<PaperDraft | null> {
  const settings = loadSettings();
  const client = await clientFor(settings);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: input }];
  let response: Anthropic.Beta.BetaMessage | undefined;
  // Server tools can pause a long turn; sending it back continues it.
  for (let round = 0; round < 4; round++) {
    response = await client.beta.messages.create({
      model: settings["claude.model"] || DEFAULT_MODEL,
      max_tokens: 4000,
      system: FIND,
      output_config: { effort: "low" },
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 4 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
      ],
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }
  const f = response && parseFound(textOf(response.content));
  if (!f?.found || !f.title) return null;
  // With an identifier, take the record from Crossref or arXiv rather than Claude's reading of it.
  for (const id of [f.arxiv && `arXiv:${f.arxiv}`, f.doi].filter(Boolean) as string[]) {
    const exact = lookups().find((l) => l.id !== "claude-find" && l.matches(id));
    const draft = exact && (await exact.resolve(id).catch(() => null));
    if (draft) return draft;
  }
  return {
    type: "article",
    title: f.title,
    authors: f.authors ?? [],
    year: f.year || undefined,
    venue: f.venue || undefined,
    abstract: f.abstract || undefined,
    url: f.url || (/^https?:\/\//.test(input) ? input : undefined),
    fields: {},
  };
}

const plugin: LightkonePlugin = {
  id: "claude",
  name: "Claude",
  description: "Summaries and questions about a paper, with your own Anthropic API key.",
  settings: [
    { name: "apiKey", label: "Anthropic API key", type: "password", help: "Stored only in this browser." },
    { name: "model", label: "Model", placeholder: DEFAULT_MODEL },
  ],
  lookups: [
    {
      id: "claude-find",
      label: "Any link or a description, found by Claude",
      // Comes after the DOI and arXiv lookups, so it only sees what they could not read.
      matches: (s) => Boolean(loadSettings()["claude.apiKey"]) && s.trim().length > 3 && !/^@\w+\s*[{(]/.test(s),
      resolve: findPaper,
    },
  ],
  actions: [
    {
      id: "summarize",
      label: "Summarize",
      async run(p, ctx) {
        const text = await askClaude(
          p,
          ctx,
          "Summarize this paper for me in four short parts: the question, the setup and method, the main result " +
            "(with the key equation if there is one), and the assumptions or limits a careful reader should keep in mind.",
        );
        return { kind: "text", title: "Summary", text };
      },
    },
    {
      id: "ask",
      label: "Ask Claude…",
      async run(p, ctx) {
        const q = ctx.ask("What would you like to know about this paper?", "How does this relate to the renormalization group?");
        if (!q) return { kind: "none" };
        return { kind: "text", title: q, text: await askClaude(p, ctx, q) };
      },
    },
  ],
};
export default plugin;
