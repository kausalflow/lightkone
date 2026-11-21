import type { Paper, StorageAdapter } from "./types";
import { makeEpub, xml, type Book, type BookChapter, type BookImage } from "./epub";

// Papers for small e-ink readers (the Xteink X4, Kobo, Kindle and others).
//
// A paper's HTML version (arXiv's, else ar5iv's for older preprints, else a
// saved web page) becomes an EPUB: the text reflows, so it fits a 4-inch
// screen at any font size. Small readers can't typeset equations, so each one
// arrives as a picture sized for the screen; simple inline math such as "x" or
// "N = 3" stays text, which keeps a paper from turning into hundreds of
// pictures. Figures are fetched and scaled down to the screen's width.
//
// The files are kept in the library's storage under lightkone/ereader/, listed
// in lightkone/ereader.json, and served to the reader as an OPDS catalog
// (functions/opds/), which the reader downloads from over Wi-Fi.

export const EREADER_DIR = "lightkone/ereader/";
export const EREADER_INDEX = "lightkone/ereader.json";
export const ereaderFile = (paperId: string) => `${EREADER_DIR}${paperId.replace(/[^\w-]/g, "_")}.epub`;

/** The screen most small readers have: 480 pixels across. Pictures are made to fit it. */
export const SCREEN_WIDTH = 480;
/** How wide a picture may be, leaving the reader's margins. */
export const PICTURE_WIDTH = 440;
const MAX_FIGURES = 60;

/** A picture made for the book: an equation or a figure. */
export interface Picture {
  data: Uint8Array;
  type: "image/png" | "image/jpeg";
  width: number;
  height: number;
  /** For inline math: pixels below the text's baseline. */
  depth?: number;
}

/** What making a book needs from outside: fetching, and drawing pictures. Tests pass their own. */
export interface EreaderDeps {
  page(url: string): Promise<{ url: string; html: string }>;
  file(url: string): Promise<{ bytes: Uint8Array; type: string }>;
  /** The picture of a MathML equation, or null when it can't be drawn. */
  math(mathml: string, display: boolean): Promise<Picture | null>;
  /** A figure scaled down to fit the screen, or null when it can't be read. */
  picture(bytes: Uint8Array, type: string): Promise<Picture | null>;
  /** The saved web page's HTML, when the paper has one. */
  saved?(paper: Paper): Promise<string | null>;
  /** Readability's main article HTML, for saved pages that aren't papers. */
  article?(doc: Document, url: string): Promise<string | null>;
  parse(html: string): Document;
  /** Called with a short line as the work goes on. */
  progress?(line: string): void;
  /** Write inline math as text this way when it can be; absent, only the simplest is text and the rest are pictures. */
  textMath?: TextMath;
}

export class EreaderError extends Error {}

export interface Sent {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  abstract?: string;
  /** Storage key of the EPUB. */
  file: string;
  size: number;
  /** ISO time it was made. */
  sent: string;
  /** Where the text came from. */
  source: "arxiv" | "ar5iv" | "page";
}

// ---------------------------------------------------------------- simple math as text

const BINARY = new Set(["=", "+", "-", "<", ">", "−"]);
const INVISIBLE = /[⁡-⁤​]/g;
const PLAIN_OP = /^[-+=()[\],./:;!|<>'−′]$/;

/** A Mathematical Alphanumeric letter (bold, italic, bold italic) as a plain letter, with its style. */
export function plainLetter(ch: string): { letter: string; bold: boolean; italic: boolean } | null {
  if (/^[A-Za-z]$/.test(ch)) return { letter: ch, bold: false, italic: true };
  if (ch === "ℎ") return { letter: "h", bold: false, italic: true };
  const cp = ch.codePointAt(0) ?? 0;
  const styles: [number, boolean, boolean][] = [
    [0x1d400, true, false],
    [0x1d434, false, true],
    [0x1d468, true, true],
  ];
  for (const [start, bold, italic] of styles) {
    const i = cp - start;
    if (i >= 0 && i < 52) return { letter: String.fromCharCode(i < 26 ? 65 + i : 97 + i - 26), bold, italic };
  }
  return null;
}

/**
 * Inline math that reads fine as plain text, as XHTML: a letter, a number, "x(t)", "N = 3".
 * Null for anything with scripts, fractions or symbols a small reader's font may lack.
 */
export function mathAsText(math: Element): string | null {
  let out = "";
  let visible = 0;
  const walk = (el: Element): boolean => {
    const tag = el.localName;
    if (tag === "annotation" || tag === "annotation-xml") return true;
    if (["math", "semantics", "mrow", "mstyle", "mpadded"].includes(tag)) {
      for (const c of Array.from(el.children)) if (!walk(c)) return false;
      return true;
    }
    if (tag === "mphantom" || tag === "mspace") return true;
    const text = (el.textContent ?? "").replace(INVISIBLE, "").trim();
    if (tag === "mi") {
      if (!text) return true;
      const letters = Array.from(text).map(plainLetter);
      if (letters.some((l) => !l)) return false;
      const word = letters.map((l) => l!.letter).join("");
      visible += word.length;
      if (word.length > 1 || el.getAttribute("mathvariant") === "normal") out += xml(word);
      else {
        const l = letters[0]!;
        out += l.bold ? `<b><i>${word}</i></b>` : `<i>${word}</i>`;
      }
      return true;
    }
    if (tag === "mn") {
      if (!/^[0-9.,]+$/.test(text)) return false;
      out += text;
      visible += text.length;
      return true;
    }
    if (tag === "mo") {
      if (!text) return true;
      if (!PLAIN_OP.test(text)) return false;
      const op = text === "−" ? "-" : text === "′" ? "'" : text;
      out += BINARY.has(text) ? ` ${xml(op)} ` : xml(op);
      visible += 1;
      return true;
    }
    if (tag === "mtext") {
      if (!/^[\x20-\x7e]*$/.test(text)) return false;
      out += xml(text);
      visible += text.length;
      return true;
    }
    return false;
  };
  if (!walk(math) || !visible || visible > 40) return null;
  return out.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- inline math as linear text

/**
 * How inline math is written as text. Small readers put every picture on a
 * line of its own, so a picture inside a sentence breaks it apart; written out
 * as text, s_t or (X_t, S_t) stays in the sentence.
 * - scripts: "tags" uses <sub>/<sup>; "plain" writes s_t and x^2, as in TeX.
 * - unicode: Greek letters and symbols as themselves (θ, ∈); off, as words (theta, in).
 */
export interface TextMath {
  scripts: "tags" | "plain";
  unicode: boolean;
}

const GREEK: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ϵ: "epsilon", ζ: "zeta", η: "eta", θ: "theta", ϑ: "theta", ι: "iota", κ: "kappa",
  λ: "lambda", μ: "mu", ν: "nu", ξ: "xi", π: "pi", ρ: "rho", ϱ: "rho", σ: "sigma", τ: "tau", υ: "upsilon", φ: "phi", ϕ: "phi", χ: "chi", ψ: "psi", ω: "omega",
  Γ: "Gamma", Δ: "Delta", Θ: "Theta", Λ: "Lambda", Ξ: "Xi", Π: "Pi", Σ: "Sigma", Υ: "Upsilon", Φ: "Phi", Ψ: "Psi", Ω: "Omega",
};
const SYMBOLS: Record<string, string> = {
  "\u2212": "-", "\u2208": " in ", "\u2209": " not in ", "\u2264": " <= ", "\u2265": " >= ", "\u2260": " != ", "\u2248": " ~ ", "\u223c": " ~ ", "\u221d": " ~ ",
  "\u2192": " -> ", "\u21a6": " -> ", "\u2190": " <- ", "\u00d7": " x ", "\u22c5": "·", "\u00b7": "·", "\u2026": "...", "\u22ef": "...", "\u221e": "inf",
  "\u2211": "sum ", "\u220f": "prod ", "\u222b": "int ", "\u2202": "d", "\u2207": "grad ", "\u00b1": "+-", "\u2032": "'", "\u2033": "''", "\u2223": "|", "\u2225": "||",
  "\u2016": "||", "\u211d": "R", "\u2115": "N", "\u2124": "Z", "\u211a": "Q", "\u2102": "C", "\u2113": "l", "\u2205": "{}", "\u27e8": "<", "\u27e9": ">", "\u2329": "<", "\u232a": ">", "\u2282": " subset ", "\u2286": " subseteq ", "\u222a": " u ", "\u2229": " n ",
  "\u2200": "for all ", "\u2203": "exists ", "\u2218": " o ", "\u2297": " (x) ", "\u2295": " (+) ", "\u2061": "", "\u2062": "", "\u2063": "", "\u2064": "", "\u200b": "",
};
const ACCENTS: Record<string, [string, string]> = {
  "\u00af": ["\u0304", "bar"], "\u203e": ["\u0304", "bar"], "\u0304": ["\u0304", "bar"], "^": ["\u0302", "hat"], "\u02c6": ["\u0302", "hat"], "\u0302": ["\u0302", "hat"],
  "~": ["\u0303", "tilde"], "\u02dc": ["\u0303", "tilde"], "\u0303": ["\u0303", "tilde"], "\u02d9": ["\u0307", "dot"], "\u0307": ["\u0307", "dot"], "\u2192": ["\u20d7", "vec"],
};
const RELATIONS = new Set(["=", "<", ">", "+", "-", "\u2212"]);

/** Visible length of XHTML text, without tags. */
const visibleLength = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "x").length;

/**
 * Inline math written out as XHTML text, e.g. "<i>s</i><sub><i>t</i></sub>" or "<i>s</i>_<i>t</i>",
 * "(<i>X</i>_<i>t</i>, θ)". Null for what text can't carry well (matrices, long formulas).
 */
export function mathAsLinear(math: Element, how: TextMath): string | null {
  const sym = (ch: string): string | null => {
    if (GREEK[ch]) return how.unicode ? ch : GREEK[ch];
    if (ch in SYMBOLS) {
      const word = SYMBOLS[ch];
      return how.unicode && word.trim() ? word.replace(word.trim(), ch) : word;
    }
    if (/^[\x20-\x7e]$/.test(ch)) return ch;
    const plain = plainLetter(ch);
    if (plain) return plain.letter;
    return how.unicode ? ch : null;
  };
  const text = (s: string): string | null => {
    let out = "";
    for (const ch of Array.from(s.replace(/\s+/g, " "))) {
      const t = sym(ch);
      if (t === null) return null;
      out += t;
    }
    return xml(out);
  };
  const group = (inner: string) => (visibleLength(inner) > 1 ? `{${inner}}` : inner);
  const script = (base: string, sub: string | null, sup: string | null): string => {
    if (how.scripts === "tags") return `${base}${sub ? `<sub>${sub}</sub>` : ""}${sup ? `<sup>${sup}</sup>` : ""}`;
    return `${base}${sub ? `_${group(sub)}` : ""}${sup ? `^${group(sup)}` : ""}`;
  };
  const walk = (el: Element): string | null => {
    const tag = el.localName;
    const kids = Array.from(el.children).filter((c) => c.localName !== "annotation" && c.localName !== "annotation-xml");
    const all = () => {
      let out = "";
      for (const c of kids) {
        const t = walk(c);
        if (t === null) return null;
        out += t;
      }
      return out;
    };
    switch (tag) {
      case "math":
      case "semantics":
      case "mrow":
      case "mstyle":
      case "mpadded":
        return all();
      case "mphantom":
        return "";
      case "mspace":
        return " ";
      case "mi": {
        const raw = (el.textContent ?? "").trim();
        if (!raw) return "";
        const letters = Array.from(raw);
        if (letters.length === 1) {
          const l = plainLetter(raw);
          if (l && el.getAttribute("mathvariant") !== "normal") return l.bold ? `<b><i>${l.letter}</i></b>` : `<i>${l.letter}</i>`;
          if (GREEK[raw] && !how.unicode) return GREEK[raw];
        }
        return text(raw);
      }
      case "mn":
        return text((el.textContent ?? "").trim());
      case "mtext":
        return text(el.textContent ?? "");
      case "mo": {
        const raw = (el.textContent ?? "").trim();
        const t = text(raw);
        if (t === null) return null;
        if (raw === ",") return ", ";
        return RELATIONS.has(raw) && el.getAttribute("form") !== "prefix" ? ` ${t.trim()} ` : t;
      }
      case "msub":
      case "msup":
      case "msubsup":
      case "munder":
      case "mover":
      case "munderover": {
        if (kids.length < 2) return null;
        const accent = tag === "mover" ? ACCENTS[(kids[1].textContent ?? "").trim()] : undefined;
        if (accent) {
          const b = walk(kids[0]);
          if (b === null) return null;
          if (how.unicode && visibleLength(b) === 1) return b.replace(/^((?:<[^>]+>)*)([^<]+)/, `$1$2${accent[0]}`);
          return `${accent[1]}(${b})`;
        }
        const [b, x, y] = kids.map(walk);
        if (b === null || x === null || y === null) return null;
        if (tag === "mover" || tag === "munder") return tag === "munder" ? script(b, x, null) : script(b, null, x);
        if (tag === "msub") return script(b, x, null);
        if (tag === "msup") return script(b, null, x);
        return script(b, x, y || null);
      }
      case "mfrac": {
        const [n, d] = kids.map(walk);
        if (n == null || d == null) return null;
        const wrapIf = (s: string) => (visibleLength(s) > 1 && /[ +\-]/.test(s.replace(/<[^>]+>/g, "")) ? `(${s.trim()})` : s.trim());
        return `${wrapIf(n)}/${wrapIf(d)}`;
      }
      case "msqrt": {
        const inner = all();
        return inner === null ? null : `${how.unicode ? "\u221a" : "sqrt"}(${inner.trim()})`;
      }
      default:
        return null;
    }
  };
  const out = walk(math);
  if (out === null) return null;
  const tidy = out.replace(/ {2,}/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/ ,/g, ",").trim();
  if (!tidy || visibleLength(tidy) > 48) return null;
  return tidy;
}

// ---------------------------------------------------------------- HTML to book chapters

const SKIP = new Set(["script", "style", "noscript", "button", "nav", "header", "footer", "form", "input", "svg", "iframe", "annotation", "annotation-xml"]);
const SKIP_CLASS = /\b(ltx_page_header|ltx_page_footer|ltx_authors|ltx_dates|ltx_title_document|ltx_TOC|ltx_rdf|ltx_ERROR|ltx_page_logo|ltx_pagination|ltx_keywords|ltx_classification|ltx_acknowledgements?_hidden|package-alerts|ar5iv-footer|ltx_role_affiliation|ltx_tag_item)\b/;
const EQUATION_TABLE = /\b(ltx_equation|ltx_equationgroup|ltx_eqn_table)\b/;
const INLINE_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "a", "i", "em", "b", "strong", "cite", "sub", "sup", "small", "label", "figcaption", "dt", "caption"]);

/** Plain text of an element, spaces tidied. */
const textOf = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** The MathML of a <math> element without its TeX annotation. */
export function cleanMathml(math: Element): string {
  const copy = math.cloneNode(true) as Element;
  copy.querySelectorAll("annotation, annotation-xml").forEach((a) => a.remove());
  return copy.outerHTML;
}

/** The inner MathML of a <math> element, without its TeX annotation, for joining several into one. */
function innerMathml(math: Element): string {
  const copy = math.cloneNode(true) as Element;
  copy.querySelectorAll("annotation, annotation-xml").forEach((a) => a.remove());
  // Unwrap <semantics><mrow>…</mrow></semantics>, so the cells of a row join into
  // one run and "=" at the start of a cell is spaced as a relation, not a prefix.
  let el: Element = copy;
  while (el.children.length === 1 && ["semantics", "mrow"].includes(el.children[0].localName)) el = el.children[0];
  return el.innerHTML;
}

interface Pictures {
  list: BookImage[];
  byKey: Map<string, { name: string; pic: Picture }>;
}

class Converter {
  pictures: Pictures = { list: [], byKey: new Map() };
  figures = 0;
  maths = 0;
  mathPictures = 0;
  constructor(
    readonly deps: EreaderDeps,
    private base: string,
    private imageType: "image/png" | "image/jpeg",
  ) {}

  private add(key: string, prefix: string, pic: Picture): string {
    const had = this.pictures.byKey.get(key);
    if (had) return had.name;
    const ext = pic.type === "image/jpeg" ? "jpg" : "png";
    const name = `${prefix}${this.pictures.list.length + 1}.${ext}`;
    this.pictures.list.push({ name, data: pic.data, type: pic.type });
    this.pictures.byKey.set(key, { name, pic });
    return name;
  }

  private imgTag(name: string, pic: Picture, cls: string, alt: string): string {
    const style = cls === "m" && pic.depth ? ` style="vertical-align:-${pic.depth}px"` : "";
    return `<img class="${cls}" src="images/${name}" width="${pic.width}" height="${pic.height}" alt="${xml(alt.slice(0, 300))}"${style}/>`;
  }

  async mathml(mathml: string, display: boolean, alt: string): Promise<string> {
    this.maths++;
    const key = `${display ? "d" : "i"}:${mathml}`;
    const had = this.pictures.byKey.get(key);
    if (had) return this.imgTag(had.name, had.pic, display ? "d" : "m", alt);
    let pic: Picture | null = null;
    try {
      pic = await this.deps.math(mathml, display);
    } catch {
      pic = null;
    }
    if (!pic) return alt ? `<i>${xml(alt)}</i>` : "";
    this.mathPictures++;
    return this.imgTag(this.add(key, "m", pic), pic, display ? "d" : "m", alt);
  }

  async math(el: Element, inline: boolean): Promise<string> {
    const display = el.getAttribute("display") === "block";
    const alt = el.getAttribute("alttext") ?? textOf(el.querySelector('annotation[encoding="application/x-tex"]'));
    if (!display) {
      const text = mathAsText(el) ?? (this.deps.textMath ? mathAsLinear(el, this.deps.textMath) : null);
      if (text !== null) {
        this.maths++;
        return text;
      }
    }
    const img = await this.mathml(cleanMathml(el), display, alt);
    return display && !inline ? `<p class="eq">${img}</p>` : img;
  }

  /** An equation table (LaTeXML's numbered and aligned equations): one picture per row, with its number. */
  async equations(table: Element, inline: boolean): Promise<string> {
    const out: string[] = [];
    for (const row of Array.from(table.querySelectorAll("tr"))) {
      const parts: string[] = [];
      let alt = "";
      for (const cell of Array.from(row.children)) {
        if (/\bltx_eqn_eqno\b/.test(cell.className)) continue;
        for (const node of Array.from(cell.childNodes)) {
          if (node.nodeType === 1 && (node as Element).localName === "math") {
            parts.push(innerMathml(node as Element));
            alt += `${(node as Element).getAttribute("alttext") ?? ""} `;
          } else if (node.textContent?.trim()) {
            parts.push(`<mtext>${xml(node.textContent.trim())}</mtext><mspace width="0.5em"></mspace>`);
          }
        }
      }
      if (!parts.length) continue;
      const tag = textOf(row.querySelector(".ltx_tag_equation, .ltx_eqn_eqno .ltx_tag"));
      const mathml = `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mstyle displaystyle="true"><mrow>${parts.join("")}</mrow></mstyle></math>`;
      const img = await this.mathml(mathml, true, alt.replace(/\\displaystyle\s*/g, "").trim());
      const number = tag ? ` <span class="tag">${xml(tag)}</span>` : "";
      out.push(inline ? `<br/>${img}${number}<br/>` : `<p class="eq">${img}${number}</p>`);
    }
    return out.join("\n");
  }

  async figure(img: Element, inline: boolean): Promise<string> {
    // LaTeXML puts SVG figures in <object data="...">.
    const src = img.localName === "object" ? img.getAttribute("data") : img.getAttribute("src");
    const alt = img.getAttribute("alt") ?? "";
    if (!src || /^data:/.test(src) || this.figures >= MAX_FIGURES) return "";
    let url: string;
    try {
      url = new URL(src, this.base).href;
    } catch {
      return "";
    }
    if (/\/static\/|logo/i.test(url)) return "";
    const had = this.pictures.byKey.get(url);
    if (had) return this.imgTag(had.name, had.pic, "d", alt);
    this.figures++;
    this.deps.progress?.(`Fetching figure ${this.figures}…`);
    try {
      const f = await this.deps.file(url);
      const pic = await this.deps.picture(f.bytes, f.type);
      if (!pic) throw new Error("unreadable");
      const tag = this.imgTag(this.add(url, "f", pic), pic, "d", alt === "Refer to caption" ? "Figure" : alt);
      return inline ? tag : `<div class="fig">${tag}</div>`;
    } catch {
      return inline ? "" : `<p class="note">[A figure couldn't be fetched.]</p>`;
    }
  }

  async children(el: Element, inline: boolean): Promise<string> {
    let s = "";
    for (const node of Array.from(el.childNodes)) s += await this.node(node, inline);
    return s;
  }

  async node(node: Node, inline: boolean): Promise<string> {
    if (node.nodeType === 3) return xml((node.textContent ?? "").replace(/\s+/g, " "));
    if (node.nodeType !== 1) return "";
    const el = node as Element;
    const tag = el.localName;
    const cls = typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "";
    if (SKIP.has(tag) || SKIP_CLASS.test(cls) || el.getAttribute("aria-hidden") === "true") return "";
    if (tag === "math") return this.math(el, inline);
    if (tag === "table" && EQUATION_TABLE.test(cls)) return this.equations(el, inline);
    if (tag === "img" || (tag === "object" && /^image\//.test(el.getAttribute("type") ?? "image/"))) return this.figure(el, inline);
    if (tag === "br") return "<br/>";

    // A footnote: its mark, then its text in brackets, where it is.
    if (/\bltx_note\b/.test(cls) && !/\bltx_note_(mark|outer|content)\b/.test(cls)) {
      const mark = textOf(el.querySelector(".ltx_note_mark"));
      const content = el.querySelector(".ltx_note_content");
      if (!content) return "";
      const copy = content.cloneNode(true) as Element;
      copy.querySelectorAll(".ltx_note_mark, .ltx_tag_note").forEach((m) => m.remove());
      const body = (await this.children(copy, true)).trim();
      return body ? `<span class="note"> [${mark ? `${xml(mark)}: ` : ""}${body}]</span>` : "";
    }

    const inner = (asInline = inline) => this.children(el, asInline);
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      const text = (await inner(true)).trim();
      if (!text) return "";
      if (inline || level >= 5) return inline ? `<b>${text}</b> ` : `<p><b>${text}</b></p>`;
      return `<h${Math.max(2, Math.min(level, 4))}>${text}</h${Math.max(2, Math.min(level, 4))}>`;
    }
    if (tag === "p") {
      const text = (await inner(true)).trim();
      if (!text) return "";
      return inline ? `${text} ` : `<p>${text}</p>\n`;
    }
    if (tag === "i" || tag === "em" || /\bltx_font_italic\b/.test(cls)) return wrap("i", await inner());
    if (tag === "b" || tag === "strong" || /\bltx_font_bold\b/.test(cls)) return wrap("b", await inner());
    if (tag === "sub" || tag === "sup") return wrap(tag, await inner(true));
    if (tag === "pre" || tag === "code" && !inline) return `<pre>${xml(el.textContent ?? "")}</pre>`;
    if (inline) return inner(true);

    if (tag === "ul" || tag === "ol") {
      const items = (await inner(false)).trim();
      const bib = /\bltx_biblist\b/.test(cls) ? ' class="bib"' : "";
      return items ? `<${tag}${bib}>${items}</${tag}>\n` : "";
    }
    if (tag === "li") {
      const body = (await this.block(el)).trim();
      return body ? `<li>${body}</li>\n` : "";
    }
    if (tag === "dl") return inner(false);
    if (tag === "dt") return `<p><b>${(await inner(true)).trim()}</b></p>\n`;
    if (tag === "dd" || tag === "blockquote") {
      const body = (await this.block(el)).trim();
      return body ? `<blockquote>${body}</blockquote>\n` : "";
    }
    if (tag === "figure") {
      let pictures = "";
      let caption = "";
      for (const c of Array.from(el.children)) {
        if (c.localName === "figcaption") caption += (await this.children(c, true)).trim();
        else pictures += await this.node(c, false);
      }
      return `${pictures}${caption ? `<p class="caption">${caption}</p>` : ""}\n`;
    }
    if (tag === "table") return this.table(el);
    // div, section, article, span-likes in block places: their content in order.
    return this.block(el);
  }

  /** An element's children where blocks may go: loose text and inline pieces are gathered into paragraphs. */
  async block(el: Element): Promise<string> {
    let out = "";
    let loose = "";
    const flush = () => {
      if (loose.trim()) out += `<p>${loose.trim()}</p>\n`;
      loose = "";
    };
    for (const node of Array.from(el.childNodes)) {
      const isInline = node.nodeType === 3 || (node.nodeType === 1 && INLINE_TAGS.has((node as Element).localName) && !/^(p|h[1-6]|figcaption|caption|dt)$/.test((node as Element).localName)) || (node.nodeType === 1 && (node as Element).localName === "math" && (node as Element).getAttribute("display") !== "block");
      if (isInline) loose += await this.node(node, true);
      else {
        flush();
        out += await this.node(node, false);
      }
    }
    flush();
    return out;
  }

  async table(el: Element): Promise<string> {
    const rows: string[] = [];
    for (const tr of Array.from(el.querySelectorAll("tr"))) {
      if (tr.closest("table") !== el) continue;
      const cells: string[] = [];
      for (const cell of Array.from(tr.children)) {
        if (cell.localName !== "td" && cell.localName !== "th") continue;
        const span = cell.getAttribute("colspan");
        const colspan = span && /^\d+$/.test(span) ? ` colspan="${span}"` : "";
        cells.push(`<${cell.localName}${colspan}>${(await this.children(cell, true)).trim()}</${cell.localName}>`);
      }
      if (cells.length) rows.push(`<tr>${cells.join("")}</tr>`);
    }
    const caption = el.querySelector(":scope > caption");
    const cap = caption ? `<p class="caption">${(await this.children(caption, true)).trim()}</p>` : "";
    return rows.length ? `<table>${rows.join("\n")}</table>${cap}\n` : cap;
  }
}

const wrap = (tag: string, s: string) => (s.trim() ? `<${tag}>${s}</${tag}>` : s);

/** "Last, First" as "First Last". */
export const displayName = (a: string) => (a.includes(",") ? a.split(",").slice(1).join(",").trim() + " " + a.split(",")[0].trim() : a).trim();

function titleChapter(p: Paper, abstract: string, source: string): BookChapter {
  const meta = [
    p.arxiv ? `arXiv:${xml(p.arxiv)}` : "",
    p.venue ? xml(p.venue) : "",
    p.year ? String(p.year) : "",
    p.doi ? `doi:${xml(p.doi)}` : "",
  ].filter(Boolean);
  const body = [
    `<h1>${xml(p.title)}</h1>`,
    p.authors.length ? `<p class="authors">${xml(p.authors.map(displayName).join(", "))}</p>` : "",
    meta.length ? `<p class="meta">${meta.join(" · ")}</p>` : "",
    abstract ? `<div class="abstract"><h2>Abstract</h2>${abstract}</div>` : "",
    `<p class="meta">Text from ${xml(source)}. Made by Lightkone for small e-ink screens.</p>`,
  ];
  return { title: "Title and abstract", body: body.filter(Boolean).join("\n") };
}

/** Chapters from a LaTeXML paper (arXiv's or ar5iv's HTML): the title page, then one chapter for each section. */
async function paperChapters(doc: Document, p: Paper, c: Converter, source: string): Promise<BookChapter[]> {
  const article = doc.querySelector("article.ltx_document") ?? doc.body;
  const abstractEl = article.querySelector(".ltx_abstract");
  let abstract = "";
  if (abstractEl) {
    const copy = abstractEl.cloneNode(true) as Element;
    copy.querySelectorAll(".ltx_title_abstract").forEach((t) => t.remove());
    abstract = (await c.block(copy)).trim();
  } else if (p.abstract) abstract = `<p>${xml(p.abstract)}</p>`;
  const chapters = [titleChapter(p, abstract, source)];
  const sections = Array.from(article.children).filter((el) => /\b(ltx_section|ltx_appendix|ltx_bibliography|ltx_chapter|ltx_part)\b/.test(el.className));
  if (!sections.length) {
    const copy = article.cloneNode(true) as Element;
    copy.querySelectorAll(".ltx_abstract").forEach((a) => a.remove());
    const body = (await c.block(copy)).trim();
    if (body) chapters.push({ title: "Text", body });
    return chapters;
  }
  let i = 0;
  for (const section of sections) {
    i++;
    c.deps.progress?.(`Section ${i} of ${sections.length}…`);
    const heading = section.querySelector(":scope > .ltx_title, :scope > h2, :scope > h1");
    const title = textOf(heading) || (/\bltx_bibliography\b/.test(section.className) ? "References" : `Section ${i}`);
    const body = (await c.block(section)).trim();
    if (body) chapters.push({ title, body });
  }
  return chapters;
}

/** arXiv's own HTML first, then ar5iv's, which has older preprints too. */
export const htmlSources = (arxiv: string): { url: string; source: Sent["source"] }[] => [
  { url: `https://arxiv.org/html/${arxiv}`, source: "arxiv" },
  { url: `https://ar5iv.labs.arxiv.org/html/${arxiv.replace(/v\d+$/, "")}`, source: "ar5iv" },
];

/** True when a page is a LaTeXML paper with text in it, not a "no HTML for this paper" page. */
export const isPaperHtml = (doc: Document) => Boolean(doc.querySelector("article.ltx_document .ltx_para, article.ltx_document .ltx_p, article.ltx_document section"));

export interface MadeBook {
  bytes: Uint8Array;
  source: Sent["source"];
  maths: number;
  mathPictures: number;
  figures: number;
}

/** The EPUB of a paper, from its HTML version. Throws an EreaderError saying why when there is none. */
export async function paperEpub(p: Paper, deps: EreaderDeps, imageType: "image/png" | "image/jpeg" = "image/png"): Promise<MadeBook> {
  let doc: Document | null = null;
  let base = "";
  let source: Sent["source"] = "arxiv";
  const tried: string[] = [];
  if (p.arxiv) {
    for (const s of htmlSources(p.arxiv)) {
      deps.progress?.(s.source === "arxiv" ? "Fetching the paper from arXiv…" : "Trying ar5iv…");
      try {
        const page = await deps.page(s.url);
        const d = deps.parse(page.html);
        if (isPaperHtml(d)) {
          doc = d;
          base = page.url || s.url;
          source = s.source;
          break;
        }
        tried.push(s.source);
      } catch {
        tried.push(s.source);
      }
    }
  }
  let generic = false;
  if (!doc && deps.saved) {
    const html = await deps.saved(p).catch(() => null);
    if (html) {
      const d = deps.parse(html);
      base = p.url ?? "https://example.invalid/";
      const article = deps.article ? await deps.article(d, base).catch(() => null) : null;
      doc = article ? deps.parse(`<html><body>${article}</body></html>`) : d;
      source = "page";
      generic = true;
    }
  }
  if (!doc) {
    throw new EreaderError(
      p.arxiv
        ? "Neither arXiv nor ar5iv has an HTML version of this paper, which the e-reader file is made from. Papers that only have a PDF will get page pictures in a later version."
        : "This paper has no HTML version to make an e-reader file from: only arXiv papers and saved web pages can be sent for now.",
    );
  }
  const c = new Converter(deps, base, imageType);
  const where = source === "arxiv" ? "arXiv's HTML version" : source === "ar5iv" ? "ar5iv (arXiv's HTML for older papers)" : p.url ?? "the saved web page";
  let chapters: BookChapter[];
  if (generic) {
    const body = (await c.block(doc.body)).trim();
    chapters = [titleChapter(p, p.abstract ? `<p>${xml(p.abstract)}</p>` : "", where), ...(body ? [{ title: "Text", body }] : [])];
  } else chapters = await paperChapters(doc, p, c, where);
  deps.progress?.("Packing the book…");
  const book: Book = {
    id: `urn:lightkone:${p.id}`,
    title: p.title,
    authors: p.authors.map(displayName),
    description: p.abstract,
    chapters,
    images: c.pictures.list,
  };
  return { bytes: await makeEpub(book), source, maths: c.maths, mathPictures: c.mathPictures, figures: c.figures };
}

/** A file name for the paper's EPUB: first author, year, a few title words. */
export function epubName(p: Paper): string {
  const first = p.authors[0] ? (p.authors[0].split(",")[0] || p.authors[0]).trim() : "";
  const words = p.title.replace(/[^\p{L}\p{N}\s-]/gu, "").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return `${[first, p.year, words].filter(Boolean).join(" - ")}.epub`.replace(/[\\/:*?"<>|]+/g, "");
}

// ---------------------------------------------------------------- the list of sent papers

export async function readSent(storage: StorageAdapter): Promise<Sent[]> {
  const raw = await storage.read(EREADER_INDEX).catch(() => null);
  if (!raw) return [];
  try {
    const body = JSON.parse(new TextDecoder().decode(raw));
    return Array.isArray(body?.papers) ? body.papers : [];
  } catch {
    return [];
  }
}

async function writeSent(storage: StorageAdapter, list: Sent[]): Promise<void> {
  await storage.write(EREADER_INDEX, JSON.stringify({ version: 1, papers: list }, null, 1), "application/json");
}

/** Makes the paper's EPUB, keeps it in storage and lists it for the e-reader's catalog. */
export async function sendToEreader(p: Paper, storage: StorageAdapter, deps: EreaderDeps, imageType: "image/png" | "image/jpeg" = "image/png", now = new Date()): Promise<{ sent: Sent; made: MadeBook }> {
  const made = await paperEpub(p, deps, imageType);
  const file = ereaderFile(p.id);
  deps.progress?.("Saving it for your e-reader…");
  await storage.write(file, made.bytes, "application/epub+zip");
  const sent: Sent = {
    id: p.id,
    title: p.title,
    authors: p.authors.map(displayName),
    year: p.year,
    abstract: p.abstract?.slice(0, 1200),
    file,
    size: made.bytes.length,
    sent: now.toISOString(),
    source: made.source,
  };
  const list = (await readSent(storage)).filter((s) => s.id !== p.id);
  await writeSent(storage, [sent, ...list]);
  return { sent, made };
}

/** Takes a paper off the e-reader's catalog, and its file out of storage when the storage can remove files. */
export async function unsend(paperId: string, storage: StorageAdapter): Promise<Sent[]> {
  const list = await readSent(storage);
  const gone = list.find((s) => s.id === paperId);
  const kept = list.filter((s) => s.id !== paperId);
  await writeSent(storage, kept);
  if (gone && storage.remove) await storage.remove(gone.file).catch(() => undefined);
  return kept;
}
