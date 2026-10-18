import type Anthropic from "@anthropic-ai/sdk";
import type { ActionContext, LightkonePlugin, Paper } from "../core/types";

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

async function askClaude(p: Paper, ctx: ActionContext, instruction: string): Promise<string> {
  const apiKey = ctx.settings["claude.apiKey"];
  if (!apiKey) throw new Error("Add your Anthropic API key under Settings → Claude first.");
  // Loaded on first use so the SDK does not slow down opening the library.
  const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
  const client = new AnthropicClient({ apiKey, dangerouslyAllowBrowser: true });

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
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return response.stop_reason === "max_tokens" ? `${text}\n\n(The answer was cut off at the length limit.)` : text;
}

const plugin: LightkonePlugin = {
  id: "claude",
  name: "Claude",
  description: "Summaries and questions about a paper, with your own Anthropic API key.",
  settings: [
    { name: "apiKey", label: "Anthropic API key", type: "password", help: "Stored only in this browser." },
    { name: "model", label: "Model", placeholder: DEFAULT_MODEL },
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
