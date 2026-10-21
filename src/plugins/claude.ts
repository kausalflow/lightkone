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

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  /** A picture of what was selected (base64 PNG), so equations arrive as typeset. */
  image?: string;
}

const EXPLAIN =
  SYSTEM +
  " The researcher is reading the paper and has selected a passage, equation or figure. Explain it in the context of this paper: " +
  "define the symbols, say where they come from in the paper, and give the step or idea that makes it work. " +
  "Be brief unless asked for more. Write mathematics in LaTeX between $...$ or $$...$$.";

/**
 * A conversation about one paper, streamed. The PDF goes first and is cached,
 * so follow-up questions do not pay for it again.
 */
export async function chatAboutPaper(
  settings: Record<string, string>,
  paper: Paper,
  pdf: Uint8Array | null,
  turns: ChatTurn[],
  onText: (soFar: string) => void,
  signal?: AbortSignal,
  where: "library" | "literature" = "library",
): Promise<string> {
  const client = await clientFor(settings);
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t, i) => {
    if (t.role === "assistant") return { role: "assistant", content: t.text };
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (i === 0) {
      if (pdf && pdf.length <= MAX_PDF_BYTES) {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(pdf) }, cache_control: { type: "ephemeral" } });
      }
      content.push({ type: "text", text: describe(paper) });
    }
    if (t.image) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: t.image } });
    content.push({ type: "text", text: t.text });
    return { role: "user", content };
  });

  const stream = client.beta.messages.stream(
    {
      model: settings["claude.model"] || DEFAULT_MODEL,
      max_tokens: 8000,
      system: EXPLAIN,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    },
    { signal },
  );
  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      text += event.delta.text;
      onText(text);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${final.stop_details?.explanation ? `: ${final.stop_details.explanation}` : "."}`);
  }
  return text;
}

const LIBRARY =
  SYSTEM +
  " Answer the researcher's question from the numbered sources, which are passages from papers in their library " +
  "(the page of the PDF, or the paper's title and abstract). Cite every claim with the number of its source in square brackets, " +
  "like [3] or [2, 5], right after the claim. Use only what the sources say; when they do not answer the question, or only " +
  "part of it, say so plainly rather than filling in from memory. Compare papers where they agree or differ. " +
  "Write mathematics in LaTeX between $...$ or $$...$$.";

const LITERATURE =
  SYSTEM +
  " Answer the researcher's question from the numbered sources, which are the titles and abstracts of published papers " +
  "found by a search of OpenAlex, not papers they have read. Cite every claim with the number of its source in square brackets, " +
  "like [3] or [2, 5], right after the claim. Use only what the abstracts say, and say plainly that you have only abstracts; " +
  "when they do not answer the question, or only part of it, say so rather than filling in from memory. Name the papers that " +
  "look most worth reading in full for this question. Write mathematics in LaTeX between $...$ or $$...$$.";

export interface LibraryTurn {
  role: "user" | "assistant";
  text: string;
  /** New sources found for this question, numbered after the earlier ones. */
  sources?: string;
}

/**
 * A conversation with the whole library, streamed. Each question brings the
 * passages found for it; the first ones are cached, so follow-ups cost less.
 */
export async function askLibrary(
  settings: Record<string, string>,
  turns: LibraryTurn[],
  onText: (soFar: string) => void,
  signal?: AbortSignal,
  where: "library" | "literature" = "library",
): Promise<string> {
  const client = await clientFor(settings);
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((t, i) =>
    t.role === "assistant"
      ? { role: "assistant", content: t.text }
      : {
          role: "user",
          content: t.sources
            ? [{ type: "text", text: `<sources>\n${t.sources}\n</sources>`, ...(i === 0 ? { cache_control: { type: "ephemeral" as const } } : {}) }, { type: "text", text: t.text }]
            : t.text,
        },
  );
  const stream = client.beta.messages.stream(
    {
      model: settings["claude.model"] || DEFAULT_MODEL,
      max_tokens: 16000,
      system: where === "literature" ? LITERATURE : LIBRARY,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    },
    { signal },
  );
  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      text += event.delta.text;
      onText(text);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${final.stop_details?.explanation ? `: ${final.stop_details.explanation}` : "."}`);
  }
  return final.stop_reason === "max_tokens" ? `${text}\n\n(The answer was cut off at the length limit.)` : text;
}

const SUPPORT =
  SYSTEM +
  " The researcher is writing a paper and wants to cite the right work for a sentence. For each numbered source, " +
  'judge whether it backs the sentence: "supports" when the source states or shows it, "related" when it is on the topic ' +
  'but does not establish the claim, "no" otherwise. Reply with only a JSON array, no other text: ' +
  '[{"n": 1, "support": "supports", "quote": "the few words in the source that back the sentence"}]. ' +
  "Give a quote only for supports, copied exactly from the source.";

/** Which of the passages back a sentence, as Claude reads them. */
export async function checkSupport(settings: Record<string, string>, sentence: string, sources: string): Promise<string> {
  const client = await clientFor(settings);
  const response = await client.beta.messages.create({
    model: settings["claude.model"] || DEFAULT_MODEL,
    max_tokens: 4000,
    system: SUPPORT,
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: `<sources>\n${sources}\n</sources>\n\nThe sentence: ${sentence}` }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."}`);
  }
  return textOf(response.content);
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
      label: "Chat about it",
      async run(p, ctx) {
        const q = await ctx.ask("What would you like to know about this paper?", "How does this relate to the renormalization group?");
        if (!q) return { kind: "none" };
        return { kind: "text", title: q, text: await askClaude(p, ctx, q), again: "Ask another question" };
      },
    },
  ],
};
export default plugin;

const EXTRACT =
  SYSTEM +
  " Read the paper and fill in one row of a table that compares papers. For each column, give the value as this paper states it, " +
  "in a few words or a short phrase (keep numbers with their units and uncertainties, and mathematics in LaTeX between $...$), " +
  'the page it is on (the text marks pages as [page n]; use 0 for the abstract), and a short exact quote it is read from. ' +
  'When the paper does not say, give the value "not stated" and no quote; never fill in from what is usual in the field. ' +
  'Reply with only a JSON object, no other text: {"cells": [{"column": "", "value": "", "page": 3, "quote": ""}]}.';

/** One row of a comparison table: the columns' values read out of one paper. */
export async function extractRow(settings: Record<string, string>, paper: Paper, text: string, full: boolean, columns: string[], signal?: AbortSignal): Promise<string> {
  const client = await clientFor(settings);
  const response = await client.beta.messages.create(
    {
      model: settings["claude.model"] || DEFAULT_MODEL,
      max_tokens: 4000,
      system: EXTRACT,
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [
        {
          role: "user",
          content: `${describe({ ...paper, abstract: full ? paper.abstract : undefined, notes: undefined })}\n\n${full ? `<text>\n${text}\n</text>` : `There is no full text, only this:\n${text || "(no abstract)"}`}\n\nColumns: ${JSON.stringify(columns)}`,
        },
      ],
    },
    { signal },
  );
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."}`);
  }
  return textOf(response.content);
}

const WEIGH =
  SYSTEM +
  " The researcher gives a claim and numbered passages from papers. Say where the papers support it, qualify it (agree only " +
  "under conditions, in a regime, or with a different size of effect) or contradict it. Each point is one finding, in a sentence " +
  "or two with the numbers and conditions that matter, read only from the passages, with the numbers of the passages it rests on. " +
  "Passages that do not bear on the claim are left out. Then a short summary of where the agreement and the disagreement lie, " +
  "and why when the passages show it (method, data, assumptions). Write mathematics in LaTeX between $...$. " +
  'Reply with only a JSON object, no other text: {"summary": "", "points": [{"stance": "supports" | "qualifies" | "contradicts", "text": "", "sources": [1, 4]}]}.';

/** Where the passages agree and disagree on a claim, as Claude reads them. */
export async function weighClaim(settings: Record<string, string>, claim: string, sources: string, signal?: AbortSignal): Promise<string> {
  const client = await clientFor(settings);
  const response = await client.beta.messages.create(
    {
      model: settings["claude.model"] || DEFAULT_MODEL,
      max_tokens: 16000,
      system: WEIGH,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: `<sources>\n${sources}\n</sources>\n\nThe claim: ${claim}` }],
    },
    { signal },
  );
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."}`);
  }
  return textOf(response.content);
}

const REVIEW = (format: "latex" | "markdown") =>
  SYSTEM +
  " Write a draft literature review of the papers given, for the researcher to edit into a paper or thesis. Group the papers by " +
  "theme or approach rather than one paragraph per paper, compare their methods, assumptions and results, say where they agree " +
  "and where they differ, and end with what is open. Use only what the papers' details say; do not add papers or results from memory. " +
  (format === "latex"
    ? "Write LaTeX body text: \\subsection{} for themes, \\cite{key} with the papers' keys exactly as given, mathematics in $...$ " +
      "or equation environments. No preamble, no \\begin{document}, no bibliography."
    : "Write Markdown: ## for themes, pandoc citations like [@key] or [@key1; @key2] with the papers' keys exactly as given, " +
      "mathematics in $...$ or $$...$$. No bibliography.") +
  " Reply with the review only.";

/** A draft literature review of a set of papers, streamed. */
export async function draftReview(
  settings: Record<string, string>,
  papers: string,
  focus: string,
  format: "latex" | "markdown",
  onText: (soFar: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const client = await clientFor(settings);
  const stream = client.beta.messages.stream(
    {
      model: settings["claude.model"] || DEFAULT_MODEL,
      max_tokens: 32000,
      system: REVIEW(format),
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: `<papers>\n${papers}\n</papers>\n\n${focus.trim() ? `What the review is for: ${focus.trim()}` : "Review these papers."}` }],
    },
    { signal },
  );
  let text = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      text += event.delta.text;
      onText(text);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new Error(`Claude declined this request${final.stop_details?.explanation ? `: ${final.stop_details.explanation}` : "."}`);
  }
  return final.stop_reason === "max_tokens" ? `${text}\n\n% The draft was cut off at the length limit.` : text;
}
