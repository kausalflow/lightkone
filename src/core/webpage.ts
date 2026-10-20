import type { Paper, PaperDraft } from "./types";
import { site } from "./site";

// Saving a web page (a blog post, a report, documentation) into the library:
// the page's raw HTML is kept as it came, and its main text as Markdown, which
// the app shows as a clean reading view and Obsidian or any editor can open.
// The page is fetched through the site's small page service
// (functions/api/page.ts), since browsers don't let one site read another's.

export const pageDir = "lightkone/pages/";
export const htmlPath = (paperId: string) => `${pageDir}${paperId}.html`;
export const markdownPath = (paperId: string) => `${pageDir}${paperId}.md`;

/** A link to a page that could be saved: http(s) and not a PDF. */
export const isWebLink = (s: string) => /^https?:\/\/[^\s/]+\.[^\s/]+\S*$/i.test(s.trim()) && !/\.pdf([?#]|$)/i.test(s.trim());

export interface FetchedPage {
  url: string;
  html: string;
}

/** The page's HTML, through the page service. Throws with the service's reason when it can't. */
export async function fetchPage(url: string, f: typeof fetch = fetch.bind(globalThis)): Promise<FetchedPage> {
  const r = await f(site(`api/page?url=${encodeURIComponent(url)}`));
  const body = (await r.json().catch(() => null)) as (FetchedPage & { error?: string }) | null;
  if (!r.ok || !body?.html) throw new Error(body?.error ?? `The page service answered ${r.status}.`);
  return body;
}

// A page fetched to look it up is kept for a moment, so saving it right after
// adding it doesn't fetch it again.
const fetched = new Map<string, FetchedPage>();

export function rememberPage(url: string, page: FetchedPage): void {
  fetched.set(url, page);
  while (fetched.size > 10) fetched.delete(fetched.keys().next().value!);
}

/** The page fetched for this link a moment ago, taken out of the cache; null if there is none. */
export function takePage(url: string | undefined): FetchedPage | null {
  const page = url ? fetched.get(url) : undefined;
  if (!page) return null;
  for (const [k, v] of fetched) if (v === page) fetched.delete(k);
  return page;
}

export const hasPage = (url: string | undefined) => Boolean(url && fetched.has(url));

// ---------------------------------------------------------------- metadata

const meta = (doc: Document, ...names: string[]): string | undefined => {
  for (const n of names) {
    const el = doc.querySelector(`meta[name="${n}" i], meta[property="${n}" i]`);
    const v = el?.getAttribute("content")?.trim();
    if (v) return v;
  }
  return undefined;
};
const metas = (doc: Document, name: string) =>
  [...doc.querySelectorAll(`meta[name="${name}" i], meta[property="${name}" i]`)].map((e) => e.getAttribute("content")?.trim() ?? "").filter(Boolean);

/** Schema.org data many sites embed (articles, blog posts, reports). */
function jsonLd(doc: Document): Record<string, any> {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.textContent ?? "");
      const all: any[] = Array.isArray(data) ? data : data["@graph"] ?? [data];
      const art = all.find((d) => /Article|Posting|Report|WebPage|ScholarlyArticle/i.test(String(d?.["@type"])));
      if (art) return art;
    } catch {
      // not JSON: skip it
    }
  }
  return {};
}

/** "First Last" or "Last, First" to the library's "Last, First". */
export function personName(name: string): string {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n || n.includes(",")) return n;
  const parts = n.split(" ");
  return parts.length > 1 ? `${parts.pop()}, ${parts.join(" ")}` : n;
}

const yearOf = (s?: string) => {
  const y = Number(/\b(1[89]\d\d|2\d{3})\b/.exec(s ?? "")?.[1]);
  return y || undefined;
};

/** The identifiers a scholarly page declares, for looking it up as a paper instead. */
export function paperIdentifier(doc: Document): string | null {
  const arxiv = meta(doc, "citation_arxiv_id");
  if (arxiv) return `arXiv:${arxiv}`;
  const doi = meta(doc, "citation_doi", "dc.identifier", "prism.doi")?.replace(/^(doi:|https?:\/\/(dx\.)?doi\.org\/)/i, "");
  return doi && /^10\.\d{4,9}\//.test(doi) ? doi : null;
}

/** What the page says about itself: title, authors, date, site and summary. */
export function pageDraft(doc: Document, url: string): PaperDraft {
  const ld = jsonLd(doc);
  const site = meta(doc, "og:site_name", "application-name") ?? (typeof ld.publisher?.name === "string" ? ld.publisher.name : undefined);
  let title = meta(doc, "citation_title", "og:title", "twitter:title", "dc.title") ?? (typeof ld.headline === "string" ? ld.headline : undefined) ?? doc.title?.trim() ?? "";
  // "<title>" often ends with the site's name.
  if (site) title = title.replace(new RegExp(`\\s*[|·–—-]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"), "");
  const ldAuthors = [ld.author].flat().map((a: any) => (typeof a === "string" ? a : a?.name)).filter((a: any): a is string => typeof a === "string");
  const authors = [...metas(doc, "citation_author"), ...(metas(doc, "citation_author").length ? [] : ldAuthors)];
  if (!authors.length) {
    const a = meta(doc, "author", "article:author", "dc.creator");
    if (a && !/^https?:/.test(a)) authors.push(...a.split(/\s*(?:;|\band\b|,(?=\s*\S+\s+\S+))\s*/).filter(Boolean));
  }
  const date = meta(doc, "citation_publication_date", "citation_date", "article:published_time", "dc.date", "date", "pubdate") ?? ld.datePublished;
  const canonical = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  const host = new URL(url).hostname.replace(/^www\./, "");
  let link = url;
  try {
    if (canonical) link = new URL(canonical, url).href;
  } catch {
    // keep the address it was fetched from
  }
  return {
    type: "misc",
    title: title.replace(/\s+/g, " ").trim() || host,
    authors: [...new Set(authors.map(personName).filter(Boolean))],
    year: yearOf(date),
    venue: site ?? host,
    abstract: meta(doc, "citation_abstract", "description", "og:description", "twitter:description"),
    url: link,
    fields: { howpublished: `\\url{${link}}`, urldate: new Date().toISOString().slice(0, 10) },
  };
}

// ---------------------------------------------------------------- Markdown

const SKIP = new Set(["script", "style", "noscript", "template", "nav", "form", "button", "input", "select", "textarea", "iframe", "svg", "canvas", "dialog", "object", "embed"]);
const BLOCK = new Set(["p", "div", "section", "article", "main", "header", "footer", "aside", "figure", "figcaption", "details", "summary", "dl", "dt", "dd", "address", "center"]);

const absolute = (href: string | null, base: string) => {
  if (!href) return null;
  try {
    const u = new URL(href, base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
};

/** TeX behind a formula the page drew with KaTeX, MathJax or MathML. */
function texOf(el: Element): { tex: string; display: boolean } | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "script" && /math\/tex/i.test(el.getAttribute("type") ?? "")) return { tex: el.textContent ?? "", display: /mode=display/i.test(el.getAttribute("type") ?? "") };
  if (el.classList.contains("katex-display") || el.classList.contains("katex") || tag === "math" || tag === "mjx-container") {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? el.getAttribute("alttext") ?? (tag === "math" ? null : el.querySelector("math")?.getAttribute("alttext"));
    if (tex) return { tex, display: el.classList.contains("katex-display") || el.getAttribute("display") === "block" || el.getAttribute("display") === "true" };
  }
  return null;
}

const escapeText = (s: string) => s.replace(/([*`])/g, "\\$1").replace(/^(\s*)([#>|-]|\d+\.)(?=\s)/, "$1\\$2");

/** Marks around text, with the spaces at its ends kept outside them ("a<b> b</b>" is "a **b**"). */
function wrap(t: string, open: string, close = open): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(t)!;
  return m[2] ? `${m[1]}${open}${m[2]}${close}${m[3]}` : t;
}

/** The Markdown for an element and what is inside it. */
export function toMarkdown(root: Element, base: string): string {
  const out: string[] = [];
  const md = (n: Node, ctx: { pre?: boolean; list?: string }): string => {
    if (n.nodeType === 3) {
      const t = n.textContent ?? "";
      return ctx.pre ? t : escapeText(t.replace(/\s+/g, " "));
    }
    if (n.nodeType !== 1) return "";
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    const math = texOf(el);
    if (math) return math.display ? `\n\n$$\n${math.tex.trim()}\n$$\n\n` : `$${math.tex.trim()}$`;
    if (SKIP.has(tag) || el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden")) return "";
    const kids = (c = ctx) => [...el.childNodes].map((k) => md(k, c)).join("");
    switch (tag) {
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": {
        const t = kids().trim();
        return t ? `\n\n${"#".repeat(Number(tag[1]))} ${t.replace(/\n+/g, " ")}\n\n` : "";
      }
      case "br": return "\n";
      case "hr": return "\n\n---\n\n";
      case "strong": case "b": return wrap(kids(), "**");
      case "em": case "i": case "cite": return wrap(kids(), "*");
      case "code": case "kbd": case "samp": return ctx.pre ? el.textContent ?? "" : `\`${(el.textContent ?? "").replace(/`/g, "'")}\``;
      case "pre": return `\n\n\`\`\`\n${(el.textContent ?? "").replace(/\n$/, "")}\n\`\`\`\n\n`;
      case "img": {
        const src = absolute(el.getAttribute("src") ?? el.getAttribute("data-src"), base);
        return src ? `![${(el.getAttribute("alt") ?? "").replace(/[\[\]\n]/g, " ").trim()}](${src})` : "";
      }
      case "a": {
        const t = kids();
        const href = absolute(el.getAttribute("href"), base);
        if (!t.trim() || !href || t.trim().startsWith("![")) return t;
        return wrap(t.replace(/\[/g, "(").replace(/\]/g, ")"), "[", `](${href})`);
      }
      case "blockquote": {
        const t = clean(kids());
        return t ? `\n\n${t.split("\n").map((l) => `> ${l}`.trimEnd()).join("\n")}\n\n` : "";
      }
      case "ul": case "ol": {
        const items = [...el.children].filter((c) => c.tagName.toLowerCase() === "li");
        // Items with no words or pictures (share buttons, icons) are left out.
        const bodies = items.map((li) => clean([...li.childNodes].map((k) => md(k, ctx)).join(""))).filter((b) => /[\p{L}\p{N}]/u.test(b) || b.includes("!["));
        const lines = bodies.map((body, i) => {
          const marker = tag === "ol" ? `${i + 1}.` : "-";
          const [first, ...rest] = body.split("\n").filter((l) => l.trim());
          return [`${marker} ${first ?? ""}`, ...rest.map((l) => `  ${l}`)].join("\n");
        });
        return lines.length ? `\n\n${lines.join("\n")}\n\n` : "";
      }
      case "table": {
        const rows = [...el.querySelectorAll("tr")].map((tr) => [...tr.children].map((c) => clean(md(c, ctx)).replace(/\n+/g, " ").replace(/\|/g, "\\|")));
        if (!rows.length) return "";
        const width = Math.max(...rows.map((r) => r.length));
        const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill("")].join(" | ")} |`;
        return `\n\n${[line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n")}\n\n`;
      }
      default: {
        const t = kids();
        return BLOCK.has(tag) || tag === "li" ? `\n\n${t}\n\n` : t;
      }
    }
  };
  out.push(md(root, {}));
  return clean(out.join(""));
}

/** Trailing spaces off, at most one blank line between blocks; code blocks are left as they are. */
function clean(s: string): string {
  return s
    .split(/(\n```\n[\s\S]*?\n```\n)/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .split("\n")
            .map((l) => l.replace(/[ \t]+$/g, "").replace(/^[ \t]+(?![-\d>|]|\s)/, ""))
            .join("\n")
            .replace(/\n{3,}/g, "\n\n"),
    )
    .join("")
    .trim();
}

/** The page's main text as Markdown: Readability finds the article, else the main element, else the body. */
export async function pageMarkdown(doc: Document, url: string): Promise<string> {
  const { Readability } = await import("@mozilla/readability");
  // Relative links and images belong to the page, not to this app.
  const base = doc.querySelector("base[href]") ?? doc.head.insertBefore(doc.createElement("base"), doc.head.firstChild);
  base.setAttribute("href", absolute(base.getAttribute("href"), url) ?? url);
  const read = (keepFigures: boolean): Element | null => {
    try {
      const reader = new Readability(doc.cloneNode(true) as Document, { keepClasses: true });
      // Readability's last clean-up drops blocks with more pictures than text, which
      // is where many sites keep their figures. Its flags are internal, so this is
      // tied to the pinned version.
      if (keepFigures) (reader as unknown as { _removeFlag(f: number): void })._removeFlag(0x4);
      const parsed = reader.parse();
      return parsed?.content ? new DOMParser().parseFromString(parsed.content, "text/html").body : null;
    } catch {
      return null;
    }
  };
  const figures = (e: Element) => [...e.querySelectorAll("img")].filter((i) => !/\.svg([?#]|$)/i.test(i.getAttribute("src") ?? "")).length;
  const words = (e: Element) => (e.textContent ?? "").split(/\s+/).length;
  let content = read(false);
  if (content && figures(content) === 0 && figures(doc.body) > 0) {
    const withFigures = read(true);
    if (withFigures && figures(withFigures) > 0 && words(withFigures) < 1.3 * words(content)) content = withFigures;
  }
  content ??= doc.querySelector("main, article, [role=main]");
  content ??= doc.body;
  return content ? toMarkdown(content, url) : "";
}

/** The whole saved copy: a short header that says what and where it came from, then the text. */
export function markdownFile(p: Pick<Paper, "title" | "authors" | "url">, text: string, savedAt = new Date()): string {
  const by = p.authors.length ? `${p.authors.map((a) => a.split(", ").reverse().join(" ")).join(", ")}\n\n` : "";
  return `# ${p.title}\n\n${by}Saved from [${p.url}](${p.url}) on ${savedAt.toISOString().slice(0, 10)}.\n\n---\n\n${text}\n`;
}
