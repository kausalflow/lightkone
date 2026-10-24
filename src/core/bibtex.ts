import type { Paper, PaperDraft } from "./types";

// A forgiving BibTeX reader and a plain writer. Handles braces and quotes,
// nested braces, numbers, @string macros, month names and "#" concatenation,
// which covers what Paperpile, Zotero, JabRef and Google Scholar export.

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

const MONTHS: Record<string, string> = {
  jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
  jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December",
};

export function parseBibtex(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const macros: Record<string, string> = { ...MONTHS };
  let i = 0;
  const n = text.length;

  const skipSpace = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  const readWord = () => {
    const start = i;
    while (i < n && /[^\s,={}()"#]/.test(text[i])) i++;
    return text.slice(start, i);
  };
  const readBraced = () => {
    // text[i] === "{"
    let depth = 0;
    const start = i + 1;
    for (; i < n; i++) {
      if (text[i] === "\\") { i++; continue; }
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) { i++; return text.slice(start, i - 1); }
    }
    return text.slice(start);
  };
  const readQuoted = () => {
    // text[i] === '"'; braces may protect quotes inside
    let depth = 0;
    const start = ++i;
    for (; i < n; i++) {
      const c = text[i];
      if (c === "\\") { i++; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === '"' && depth === 0) { i++; return text.slice(start, i - 1); }
    }
    return text.slice(start);
  };
  const readValue = () => {
    const parts: string[] = [];
    for (;;) {
      skipSpace();
      const c = text[i];
      if (c === "{") parts.push(readBraced());
      else if (c === '"') parts.push(readQuoted());
      else {
        const w = readWord();
        if (!w) break;
        parts.push(/^\d+$/.test(w) ? w : macros[w.toLowerCase()] ?? w);
      }
      skipSpace();
      if (text[i] === "#") { i++; continue; }
      break;
    }
    return parts.join("");
  };

  while (i < n) {
    const at = text.indexOf("@", i);
    if (at < 0) break;
    i = at + 1;
    const type = readWord().toLowerCase();
    skipSpace();
    const open = text[i];
    if (open !== "{" && open !== "(") continue;
    const close = open === "{" ? "}" : ")";
    i++;
    if (type === "comment") { i = at + 1; continue; }
    if (type === "preamble") { readValue(); continue; }
    if (type === "string") {
      skipSpace();
      const name = readWord().toLowerCase();
      skipSpace();
      if (text[i] === "=") { i++; macros[name] = readValue(); }
      continue;
    }
    skipSpace();
    const keyStart = i;
    // Braces in a key ("Erd\\H{o}s1959") are part of it, not the end of the entry.
    for (let depth = 0; i < n && (depth > 0 || (text[i] !== "," && text[i] !== close)); i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
    }
    const key = text.slice(keyStart, i).trim();
    const fields: Record<string, string> = {};
    while (i < n && text[i] !== close) {
      if (text[i] === ",") i++;
      skipSpace();
      if (text[i] === close) break;
      const name = readWord().toLowerCase();
      skipSpace();
      if (!name || text[i] !== "=") {
        // malformed field: skip any values it has, then to the next comma or the end of the entry
        while (i < n && text[i] !== "," && text[i] !== close) {
          if (text[i] === "{") readBraced();
          else if (text[i] === '"') readQuoted();
          else i++;
        }
        continue;
      }
      i++;
      fields[name] = readValue().replace(/\s+/g, " ").trim();
      skipSpace();
    }
    i++;
    if (key || Object.keys(fields).length) entries.push({ type, key, fields });
  }
  return entries;
}

/** Removes protective braces and the most common LaTeX escapes, for display and search. */
const ACCENTS: Record<string, string> = { '"': "\u0308", "'": "\u0301", "`": "\u0300", "^": "\u0302", "~": "\u0303", "=": "\u0304", ".": "\u0307", c: "\u0327", v: "\u030C", u: "\u0306", H: "\u030B" };

const LETTERS: Record<string, string> = { ss: "ß", o: "ø", O: "Ø", ae: "æ", AE: "Æ", l: "ł", L: "Ł", i: "ı" };

export function plain(value: string): string {
  return value
    .replace(/\{?\\([\"'`^~=.]|[cvuH](?=[\s{]))\s*\{?([A-Za-z]|\\[ij]\b)\}?\}?/g, (_, a: string, ch: string) =>
      // \i and \j are the dotless letters LaTeX puts accents on: \"{\i} is ï.
      (ch.replace("\\", "") + ACCENTS[a]).normalize("NFC"),
    )
    .replace(/\{\\(ss|o|O|ae|AE|l|L|i)\}|\\(ss|o|O|ae|AE|l|L|i)\b ?/g, (_, a?: string, b?: string) => LETTERS[(a ?? b)!])
    .replace(/\\(?:emph|textit|textbf|mathrm|textrm)\{([^{}]*)\}/g, "$1")
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/(?<!\\)[{}]/g, "")
    .replace(/~/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ARXIV_IN_URL = /arxiv\.org\/(?:abs|pdf|html)\/([^\s?#]+?)(?:v\d+)?(?:\.pdf)?(?:[?#]|$)/i;

export function entryToDraft(entry: BibEntry): PaperDraft {
  const f = { ...entry.fields };
  const take = (name: string) => {
    const v = f[name];
    delete f[name];
    return v;
  };
  const title = plain(take("title") ?? "");
  const authors = splitAuthors(take("author") ?? take("editor") ?? "");
  const yearRaw = take("year");
  const year = yearRaw && /\d{4}/.test(yearRaw) ? Number(yearRaw.match(/\d{4}/)![0]) : undefined;
  // The first of journal, booktitle, publisher that says something: an empty journal = {} does not hide the booktitle.
  let venue = plain(take("journal") ?? "");
  if (!venue) venue = plain(take("booktitle") ?? "");
  if (!venue) venue = plain(f.publisher ?? "");
  const abstract = take("abstract");
  const doi = take("doi")?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  const url = take("url");
  const eprint = take("eprint");
  const arxivid = take("arxivid");
  const prefix = (f.archiveprefix ?? f.eprinttype ?? "").toLowerCase();
  let arxiv = arxivid || (prefix === "arxiv" ? eprint : undefined) || url?.match(ARXIV_IN_URL)?.[1];
  if (!arxiv && eprint && /^\d{4}\.\d{4,5}/.test(eprint)) arxiv = eprint;
  if (arxiv) {
    delete f.archiveprefix;
    delete f.eprinttype;
    delete f.primaryclass;
  } else if (eprint) {
    f.eprint = eprint;
  }
  // Some exporters stuff identifiers into keywords ("doi:10.1103/... url:https://..."); those are not tags.
  const tags = (take("keywords") ?? "")
    .split(/[;,]/)
    .map((t) => plain(t))
    .filter((t) => t && !/^(doi|url|arxiv|isbn|issn|pmid|pmc):|https?:\/\//i.test(t));
  const file = take("file");
  const notes = take("annote") ?? take("note");
  return {
    key: entry.key,
    type: entry.type,
    title,
    authors,
    year,
    venue: venue || undefined,
    abstract: abstract ? plain(abstract) : undefined,
    doi: doi || undefined,
    arxiv: arxiv?.replace(/^arxiv:/i, "").replace(/v\d+$/, "") || undefined,
    url,
    tags,
    file,
    notes,
    fields: f,
  };
}

export function splitAuthors(value: string): string[] {
  if (!value.trim()) return [];
  return value
    .split(/\s+and\s+/i)
    .map((raw) => [raw.trim(), plain(raw)] as const)
    .filter(([, a]) => a)
    .map(([raw, a]) => {
      // "{LIGO Scientific Collaboration}" is a corporate name: never flip it.
      if (a.includes(",") || a.toLowerCase() === "others" || /^\{.*\}$/s.test(raw)) return a;
      const parts = a.split(" ");
      return parts.length > 1 ? `${parts.pop()}, ${parts.join(" ")}` : a;
    });
}

export const parseBibtexToDrafts = (text: string): PaperDraft[] =>
  parseBibtex(text).filter((e) => e.fields.title).map(entryToDraft);

const escape = (v: string) => v.replace(/\\?([&%#])/g, "\\$1");

export function paperToBibtex(p: Paper): string {
  const lines: [string, string][] = [];
  const add = (name: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") lines.push([name, String(value)]);
  };
  add("title", `{${escape(p.title)}}`);
  add("author", p.authors.map((a) => (a.includes(",") || a === "others" ? a : `{${a}}`)).join(" and "));
  add("year", p.year);
  const venueField = p.type === "inproceedings" || p.type === "incollection" ? "booktitle" : "journal";
  if (p.venue && !p.fields[venueField]) add(venueField, escape(p.venue));
  add("doi", p.doi);
  if (p.arxiv) {
    add("eprint", p.arxiv);
    add("archiveprefix", "arXiv");
  }
  add("url", p.url);
  add("abstract", p.abstract && escape(p.abstract));
  if (p.tags.length) add("keywords", p.tags.join(";"));
  add("file", p.file);
  for (const [k, v] of Object.entries(p.fields)) if (!k.startsWith("lightkone-")) add(k, v);
  const width = Math.max(...lines.map(([k]) => k.length));
  const body = lines.map(([k, v]) => `  ${k.padEnd(width)} = {${v}}`).join(",\n");
  return `@${p.type || "misc"}{${p.key},\n${body}\n}\n`;
}

export const libraryToBibtex = (papers: Paper[]): string => papers.map(paperToBibtex).join("\n");
