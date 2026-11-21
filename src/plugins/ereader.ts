import type { LightkonePlugin, Paper, StorageAdapter } from "../core/types";
import { epubName, EreaderError, paperEpub, readSent, sendToEreader, type EreaderDeps, type MadeBook, type TextMath } from "../core/ereader";
import type { MathLook } from "../core/pictures";
import { REFLOW_LINES } from "../core/pdfreflow";
import { fetchPage } from "../core/webpage";
import { fetchFile } from "../core/remotefile";

// Send to e-reader: a paper as an EPUB for a small e-ink reader (core/ereader.ts),
// kept in the library's storage and listed in the e-reader catalog, or downloaded
// to load by hand (the reader's app, USB, an SD card).

type ImageType = "image/png" | "image/jpeg";
const imageType = (settings: Record<string, string>): ImageType => (/^jpe?g$/i.test((settings["ereader.pictures"] ?? "").trim()) ? "image/jpeg" : "image/png");

/**
 * Inline math: "text" (default) writes it into the sentence with small raised and
 * lowered letters (s<sub>t</sub>, θ ∈ ℝ); "plain" as in TeX with words (s_t, theta in R)
 * for readers whose font lacks Greek or that ignore sub/sup; "pictures" makes every
 * formula that isn't plain letters a picture, as before.
 */
export function textMath(settings: Record<string, string>): TextMath | undefined {
  const v = (settings["ereader.inline"] ?? "").trim().toLowerCase();
  if (v === "pictures" || v === "picture" || v === "images") return undefined;
  if (v === "plain") return { scripts: "plain", unicode: false };
  return { scripts: "tags", unicode: true };
}

const MATH_EX: Record<string, number> = { small: 10, medium: 13, large: 16 };

/** How large and how bold equation pictures are drawn: sized to the reader's text ("medium" fits the X4's default font). */
export function mathLook(settings: Record<string, string>): MathLook {
  const v = (settings["ereader.mathsize"] ?? "").trim().toLowerCase();
  const n = Number(v);
  const ex = MATH_EX[v] ?? (n >= 6 && n <= 30 ? n : MATH_EX.medium);
  return { ex, weight: 30 };
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** The file service, waiting and trying again when it says too many at once (a paper with many figures). */
async function fileWithRetry(url: string): Promise<{ bytes: Uint8Array; type: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const f = await fetchFile(url);
      return { bytes: f.bytes, type: f.type };
    } catch (e) {
      if (attempt < 3 && /too many requests/i.test((e as Error).message)) {
        const s = Number(/(\d+) s/.exec((e as Error).message)?.[1] ?? 10);
        await sleep(Math.min(60, s) * 1000);
        continue;
      }
      throw e;
    }
  }
}

/** What making a book needs, in the browser. */
export function browserDeps(storage: StorageAdapter | null, type: ImageType, settings: Record<string, string> = {}): EreaderDeps {
  const look = mathLook(settings);
  return {
    textMath: textMath(settings),
    page: (url) => fetchPage(url),
    file: fileWithRetry,
    async math(mathml, display) {
      const { mathPicture } = await import("../core/pictures");
      return mathPicture(mathml, display, type, look);
    },
    async picture(bytes, t) {
      const { figurePicture } = await import("../core/pictures");
      return figurePicture(bytes, t, type);
    },
    async saved(p: Paper) {
      if (!storage || !p.html) return null;
      const bytes = await storage.read(p.html);
      return bytes ? new TextDecoder().decode(bytes) : null;
    },
    async article(doc) {
      const { Readability } = await import("@mozilla/readability");
      return new Readability(doc.cloneNode(true) as Document).parse()?.content ?? null;
    },
    parse: (html) => new DOMParser().parseFromString(html, "text/html"),
    async pdf(p: Paper) {
      const own = p.pdf ?? p.attachments?.find((a) => a.type === "application/pdf" || /\.pdf$/i.test(a.name))?.path;
      if (storage && own) {
        const bytes = await storage.read(own).catch(() => null);
        if (bytes) return bytes;
      }
      if (p.arxiv) return (await fileWithRetry(`https://arxiv.org/pdf/${p.arxiv}`)).bytes;
      return null;
    },
    async pdfPages(bytes, each) {
      const { pdfGreyPages } = await import("../reader/view");
      await pdfGreyPages(bytes, each);
    },
    preferPdf: /^pdf$/i.test((settings["ereader.from"] ?? "").trim()),
    reflow: { line: REFLOW_LINES[(settings["ereader.pdfsize"] ?? "").trim().toLowerCase()] ?? REFLOW_LINES.medium },
  };
}

const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/** One line on what went into the book. */
export function madeLine(m: MadeBook): string {
  if (m.source === "pdf") return `Made from the PDF: ${m.pages} page${m.pages === 1 ? "" : "s"} re-flowed onto ${m.screens} screen${m.screens === 1 ? "" : "s"}, ${kb(m.bytes.length)}.`;
  const from = m.source === "arxiv" ? "arXiv's HTML version" : m.source === "ar5iv" ? "ar5iv (arXiv's HTML for older papers)" : "the saved web page";
  const bits = [`${m.mathPictures} equation${m.mathPictures === 1 ? "" : "s"} as pictures`, `${m.figures} figure${m.figures === 1 ? "" : "s"}`, kb(m.bytes.length)];
  return `Made from ${from}: ${bits.join(", ")}.`;
}

function save(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/epub+zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const canMake = (p: Paper) => Boolean(p.arxiv || p.html || p.pdf || p.attachments?.some((a) => a.type === "application/pdf" || /\.pdf$/i.test(a.name)));

const plugin: LightkonePlugin = {
  id: "ereader",
  name: "Send to e-reader",
  description:
    "Makes an EPUB of a paper for small e-ink readers such as the Xteink X4, Kobo or Kindle: the text reflows to the screen and each equation is a sharp picture. Papers with only a PDF have their pages cut into words and laid out again at a readable size. Sent papers are listed in your e-reader catalog (Settings → E-reader).",
  settings: [
    {
      name: "pictures",
      label: "Picture format",
      placeholder: "png",
      help: "png (default) keeps equations sharpest. Write jpeg if your reader shows the text but no equations.",
    },
    {
      name: "from",
      label: "Make it from",
      placeholder: "html",
      help: "html (default): the paper's HTML version when it has one (arXiv, ar5iv, a saved page), else its PDF. pdf: always the PDF's pages, re-flowed to the screen as pictures, which keeps the paper's own typesetting.",
    },
    {
      name: "pdfsize",
      label: "PDF text size",
      placeholder: "medium",
      help: "How large re-flowed PDF text is: small, medium (default) or large.",
    },
    {
      name: "inline",
      label: "Math in sentences",
      placeholder: "text",
      help: "text (default): s with a lowered t, θ ∈ ℝ, kept in the sentence. plain: s_t, theta in R, for readers that show boxes for Greek letters. pictures: a picture for each formula (some readers put every picture on its own line).",
    },
    {
      name: "mathsize",
      label: "Equation size",
      placeholder: "medium",
      help: "small, medium (default, fits the Xteink X4's normal font) or large. Use large if you read with a big font.",
    },
  ],
  actions: [
    {
      id: "send",
      label: "Send to e-reader",
      available: canMake,
      async run(p, ctx) {
        if (!ctx.storage) throw new Error("Open a library first.");
        try {
          const { made } = await sendToEreader(p, ctx.storage, browserDeps(ctx.storage, imageType(ctx.settings), ctx.settings), imageType(ctx.settings));
          const provider = ctx.settings["storage.provider"] || "browser";
          const count = (await readSent(ctx.storage)).length;
          const where =
            provider === "browser"
              ? "Your library lives in this browser, so your e-reader can't reach its catalog: use **Download for e-reader** instead, or keep the library in an S3/R2 bucket or GitHub repository."
              : `It is in your e-reader catalog (${count} paper${count === 1 ? "" : "s"}). On the reader, open the Lightkone catalog and download it. No catalog yet? Make its address in Settings → E-reader.`;
          return { kind: "text", title: "Sent to your e-reader", text: `${madeLine(made)}\n\n${where}` };
        } catch (e) {
          if (e instanceof EreaderError) throw e;
          throw new Error(`The e-reader file couldn't be made: ${(e as Error).message}`);
        }
      },
    },
    {
      id: "download",
      label: "Download for e-reader",
      available: canMake,
      async run(p, ctx) {
        const made = await paperEpub(p, browserDeps(ctx.storage, imageType(ctx.settings), ctx.settings), imageType(ctx.settings));
        save(epubName(p), made.bytes);
        return {
          kind: "text",
          title: "Downloaded for your e-reader",
          text: `${madeLine(made)}\n\nLoad the EPUB with your reader's app (on the Xteink app: **Import**), over USB, or from its SD card.`,
        };
      },
    },
  ],
};
export default plugin;
