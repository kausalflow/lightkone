import type { Paper } from "./types";
import { unicodeMath } from "./cite";

// Citations in any of the 10,000+ journal styles of the Citation Style
// Language, the ones Zotero and Mendeley use. Styles come from the CSL
// project's repository when first used and are kept in this browser;
// citeproc-js formats them, loaded only when a style is used.

const RAW = "https://raw.githubusercontent.com/citation-style-language";
export const STYLE_INDEX = "https://www.zotero.org/styles-files/styles.json";
const CACHE = "lightkone.csl.";
export const CHOSEN_KEY = "lightkone.csl.chosen";

export interface CslStyle {
  /** The style's file name in the CSL repository, e.g. "american-physics-society". */
  id: string;
  title: string;
}

/** Styles offered before any is chosen: what physicists, astronomers and their neighbours most often need. */
export const COMMON_STYLES: CslStyle[] = [
  { id: "american-physics-society", title: "American Physical Society (Phys. Rev.)" },
  { id: "american-institute-of-physics", title: "American Institute of Physics" },
  { id: "institute-of-physics-numeric", title: "Institute of Physics (numeric)" },
  { id: "the-astrophysical-journal", title: "The Astrophysical Journal" },
  { id: "journal-of-cosmology-and-astroparticle-physics", title: "JCAP" },
  { id: "nature", title: "Nature" },
  { id: "science", title: "Science" },
  { id: "ieee", title: "IEEE" },
  { id: "chicago-author-date", title: "Chicago (author-date)" },
];

function cached(key: string): string | null {
  try {
    return localStorage.getItem(CACHE + key);
  } catch {
    return null;
  }
}
function remember(key: string, xml: string) {
  try {
    localStorage.setItem(CACHE + key, xml);
  } catch {
    // full or private: fetched again next time
  }
}

async function getText(url: string, f: typeof fetch): Promise<string | null> {
  const r = await f(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Could not fetch the style (${r.status}). Try again in a minute.`);
  return r.text();
}

/** The parent style a dependent style (a journal that borrows another's format) points to. */
export function parentOf(xml: string): string | null {
  const m = /<link[^>]*rel="independent-parent"[^>]*>/.exec(xml) ?? null;
  const href = m && /href="([^"]+)"/.exec(m[0]);
  return href ? href[1].split("/").pop()! : null;
}

/** A style's CSL, following a journal's dependent style to the one it borrows; kept in this browser. */
export async function getStyle(id: string, f: typeof fetch = fetch): Promise<string> {
  const hit = cached(`style.${id}`);
  if (hit) return hit;
  let xml = await getText(`${RAW}/styles/master/${id}.csl`, f);
  if (!xml) {
    const dep = await getText(`${RAW}/styles/master/dependent/${id}.csl`, f);
    const parent = dep && parentOf(dep);
    if (!parent) throw new Error(`There is no citation style called "${id}".`);
    xml = await getText(`${RAW}/styles/master/${parent}.csl`, f);
    if (!xml) throw new Error(`The style "${id}" points to "${parent}", which could not be found.`);
  }
  remember(`style.${id}`, xml);
  return xml;
}

/** The language a style is written for, or US English. */
export function localeOf(style: string): string {
  return /default-locale="([^"]+)"/.exec(style)?.[1] ?? "en-US";
}

async function getLocale(lang: string, f: typeof fetch): Promise<string> {
  const hit = cached(`locale.${lang}`);
  if (hit) return hit;
  const xml = (await getText(`${RAW}/locales/master/locales-${lang}.xml`, f)) ?? (await getText(`${RAW}/locales/master/locales-en-US.xml`, f));
  if (!xml) throw new Error("Could not fetch the style's language file.");
  remember(`locale.${lang}`, xml);
  return xml;
}

const TYPES: Record<string, string> = {
  article: "article-journal",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  book: "book",
  incollection: "chapter",
  inbook: "chapter",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  techreport: "report",
  unpublished: "manuscript",
  online: "webpage",
  misc: "article",
};

const person = (a: string) => {
  if (a.includes(",")) {
    const [family, given] = a.split(",").map((s) => s.trim());
    return { family: family.replace(/[{}]/g, ""), given: given?.replace(/[{}]/g, "") };
  }
  const parts = a.trim().split(/\s+/);
  return parts.length > 1 ? { family: parts.pop()!, given: parts.join(" ") } : { literal: a.replace(/[{}]/g, "") };
};

/** A paper as a CSL-JSON item. */
export function toCslItem(p: Paper): Record<string, unknown> {
  const f = p.fields;
  const preprint = !p.venue && !p.doi && p.arxiv;
  return {
    id: p.key,
    type: preprint ? "article" : TYPES[p.type] ?? "article-journal",
    title: unicodeMath(p.title.replace(/[{}]/g, "")),
    author: p.authors.map(person),
    ...(p.year ? { issued: { "date-parts": [[p.year]] } } : {}),
    ...(p.venue ? { "container-title": p.venue } : preprint ? { "container-title": "arXiv", number: `arXiv:${p.arxiv}` } : {}),
    ...(f.volume ? { volume: f.volume } : {}),
    ...(f.number ? { issue: f.number } : {}),
    ...(f.pages ? { page: f.pages.replace(/-+/, "–") } : {}),
    ...(f.publisher ? { publisher: f.publisher } : {}),
    ...(p.doi ? { DOI: p.doi } : {}),
    ...(p.url || p.arxiv ? { URL: p.url || `https://arxiv.org/abs/${p.arxiv}` } : {}),
  };
}

/** The papers formatted in a style, one entry per paper, in the style's order. Plain text, or HTML for pasting into a document. */
export async function formatBibliography(papers: Paper[], styleId: string, format: "text" | "html" = "text", f: typeof fetch = fetch): Promise<string[]> {
  if (!papers.length) return [];
  const style = await getStyle(styleId, f);
  const locale = await getLocale(localeOf(style), f);
  const { default: CSL } = (await import("citeproc")) as any;
  const items = new Map(papers.map((p) => [p.key, toCslItem(p)]));
  const engine = new CSL.Engine({ retrieveLocale: () => locale, retrieveItem: (id: string) => items.get(id) }, style);
  engine.setOutputFormat(format);
  engine.updateItems([...items.keys()]);
  const out = engine.makeBibliography();
  if (!out) throw new Error("This style makes in-text citations only, not a reference list.");
  return (out[1] as string[]).map((s) => (format === "text" ? s.trim() : s));
}

/** The styles chosen for the Cite menu, most recent first. */
export function chosenStyles(): CslStyle[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHOSEN_KEY) || "null");
    if (Array.isArray(v)) return v.filter((s) => s && typeof s.id === "string");
  } catch {
    // private window
  }
  return [COMMON_STYLES[0]];
}

export function chooseStyle(s: CslStyle): CslStyle[] {
  const next = [s, ...chosenStyles().filter((x) => x.id !== s.id)].slice(0, 4);
  try {
    localStorage.setItem(CHOSEN_KEY, JSON.stringify(next));
  } catch {
    // private window
  }
  return next;
}

let index: Promise<CslStyle[]> | null = null;
/** Every style in the CSL repository, journals included: about 11,000. Fetched once per visit. */
export function styleIndex(f: typeof fetch = fetch): Promise<CslStyle[]> {
  index ??= f(STYLE_INDEX)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`The list of styles answered ${r.status}.`))))
    .then((all: { name: string; title: string }[]) => all.map((s) => ({ id: s.name, title: s.title })))
    .catch((e) => {
      index = null;
      throw e;
    });
  return index;
}

/** Styles whose title or name has every word typed, shortest title first. */
export function findStyles(all: CslStyle[], q: string, max = 30): CslStyle[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return all
    .filter((s) => words.every((w) => `${s.title} ${s.id}`.toLowerCase().includes(w)))
    .sort((a, b) => a.title.length - b.title.length)
    .slice(0, max);
}
