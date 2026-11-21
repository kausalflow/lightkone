import type { LightkonePlugin, Paper, StorageAdapter } from "../core/types";
import { epubName, EreaderError, paperEpub, readSent, sendToEreader, type EreaderDeps, type MadeBook } from "../core/ereader";
import { fetchPage } from "../core/webpage";
import { fetchFile } from "../core/remotefile";

// Send to e-reader: a paper as an EPUB for a small e-ink reader (core/ereader.ts),
// kept in the library's storage and listed in the e-reader catalog, or downloaded
// to load by hand (the reader's app, USB, an SD card).

type ImageType = "image/png" | "image/jpeg";
const imageType = (settings: Record<string, string>): ImageType => (/^jpe?g$/i.test((settings["ereader.pictures"] ?? "").trim()) ? "image/jpeg" : "image/png");

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
export function browserDeps(storage: StorageAdapter | null, type: ImageType): EreaderDeps {
  return {
    page: (url) => fetchPage(url),
    file: fileWithRetry,
    async math(mathml, display) {
      const { mathPicture } = await import("../core/pictures");
      return mathPicture(mathml, display, type);
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
  };
}

const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/** One line on what went into the book. */
export function madeLine(m: MadeBook): string {
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

const canMake = (p: Paper) => Boolean(p.arxiv || p.html);

const plugin: LightkonePlugin = {
  id: "ereader",
  name: "Send to e-reader",
  description:
    "Makes an EPUB of a paper for small e-ink readers such as the Xteink X4, Kobo or Kindle: the text reflows to the screen and each equation is a sharp picture. Sent papers are listed in your e-reader catalog (Settings → E-reader).",
  settings: [
    {
      name: "pictures",
      label: "Picture format",
      placeholder: "png",
      help: "png (default) keeps equations sharpest. Write jpeg if your reader shows the text but no equations.",
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
          const { made } = await sendToEreader(p, ctx.storage, browserDeps(ctx.storage, imageType(ctx.settings)), imageType(ctx.settings));
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
        const made = await paperEpub(p, browserDeps(ctx.storage, imageType(ctx.settings)), imageType(ctx.settings));
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
