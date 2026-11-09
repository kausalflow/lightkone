import { terms } from "./ask";

// Cite my draft: read a LaTeX manuscript, find the sentences that make a claim
// but cite nothing, and put \cite{…} into them once papers are chosen. The
// sentences keep their place in the source, so the .tex comes back exactly as
// it was apart from the citations added.

export interface Sentence {
  /** Number in the draft, from 1, in reading order. */
  n: number;
  /** Where the sentence starts and ends in the source. */
  start: number;
  end: number;
  /** Where a citation goes: just before the closing full stop, or at the end. */
  at: number;
  /** Line in the source where the sentence starts, from 1. */
  line: number;
  /** The source of the sentence, as written. */
  tex: string;
  /** The sentence as words, without commands, math or citations. */
  plain: string;
  cited: boolean;
  /** How much it reads like a claim someone else made: 0 is not at all. */
  score: number;
  /** Words that made it read like a claim. */
  cues: string[];
}

/** Display mathematics: part of the sentence around it, but nothing inside ends one. */
const MATH_ENVS = "equation|align|alignat|flalign|gather|multline|eqnarray|displaymath|math|subequations";
/** Environments read past entirely: floats, code and the abstract. */
const SKIP_ENVS = "figure|table|tabular|tabularx|longtable|verbatim|Verbatim|lstlisting|minted|tikzpicture|thebibliography|abstract|comment|algorithm|algorithmic";
const SECTION = /\\(?:part|chapter|section|subsection|subsubsection|paragraph|subparagraph|caption|title|author|date|affiliation|keywords|pacs)\*?\s*(?:\[[^\]]*\])?\s*\{/y;
/** Commands whose argument is not prose; nothing inside them ends a sentence. */
const OPAQUE = /\\(?:[a-zA-Z]*cite[a-zA-Z]*|label|ref|eqref|autoref|cref|Cref|pageref|url|href|includegraphics|input|include|footnotemark)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{/y;
const CITE = /\\(?:no)?(?:[a-zA-Z]*cite[a-zA-Z]*|footcite[a-z]*)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{/;

/** Words before a full stop that do not end a sentence. */
const ABBREV = new Set(
  "e.g i.e cf vs al fig figs eq eqs ref refs sec secs tab app ch chap no nos vol pp p resp approx ca et viz etc dr prof mr ms st thm lem prop def cor phys rev lett nucl astrophys astron mon soc proc natl acad sci ann j jhep jcap".split(" "),
);

/** The index just past the brace group that opens at `open` (the `{`). */
function closeBrace(tex: string, open: number): number {
  let depth = 0;
  for (let i = open; i < tex.length; i++) {
    const c = tex[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return tex.length;
}

/** The part of the source that is the document's text: after \begin{document}, before the bibliography. */
export function bodyRange(tex: string): [number, number] {
  const begin = tex.search(/\\begin\s*\{document\}/);
  const start = begin < 0 ? 0 : tex.indexOf("}", begin) + 1;
  const rest = tex.slice(start);
  const stop = rest.search(/\\end\s*\{document\}|\\bibliography\s*\{|\\printbibliography|\\begin\s*\{thebibliography\}/);
  return [start, stop < 0 ? tex.length : start + stop];
}

/**
 * What each character of the source is: 0 prose, 1 skipped and a break
 * between sentences (headings, floats, code), 2 part of the sentence but
 * never its end (mathematics, labels, citations, links), 3 a comment, which
 * is neither text nor a break.
 */
export function maskOf(tex: string): Uint8Array {
  const mask = new Uint8Array(tex.length);
  const [from, to] = bodyRange(tex);
  mask.fill(1, 0, from);
  mask.fill(1, to);
  const envOpen = new RegExp(`\\\\begin\\s*\\{(${MATH_ENVS}|${SKIP_ENVS})(\\*?)\\}`, "y");
  const isMath = new RegExp(`^(?:${MATH_ENVS})$`);
  for (let i = from; i < to; i++) {
    const c = tex[i];
    if (c === "%") {
      const eol = tex.indexOf("\n", i);
      const end = eol < 0 ? tex.length : eol;
      mask.fill(3, i, end);
      i = end - 1;
      continue;
    }
    if (c === "\\") {
      const next = tex[i + 1];
      if (next === "[" || next === "(") {
        const close = tex.indexOf(next === "[" ? "\\]" : "\\)", i + 2);
        const end = close < 0 ? to : close + 2;
        mask.fill(2, i, end);
        i = end - 1;
        continue;
      }
      envOpen.lastIndex = i;
      const env = envOpen.exec(tex);
      if (env) {
        const closer = new RegExp(`\\\\end\\s*\\{${env[1]}${env[2] ? "\\*" : ""}\\}`, "g");
        closer.lastIndex = envOpen.lastIndex;
        const m = closer.exec(tex);
        const end = m ? m.index + m[0].length : to;
        mask.fill(isMath.test(env[1]) ? 2 : 1, i, end);
        i = end - 1;
        continue;
      }
      SECTION.lastIndex = i;
      if (SECTION.test(tex)) {
        const end = closeBrace(tex, SECTION.lastIndex - 1);
        mask.fill(1, i, end);
        i = end - 1;
        continue;
      }
      OPAQUE.lastIndex = i;
      if (OPAQUE.test(tex)) {
        const end = closeBrace(tex, OPAQUE.lastIndex - 1);
        mask.fill(2, i, end);
        i = end - 1;
        continue;
      }
      // \begin{…}, \end{…}, \item and a few layout commands break sentences too.
      const cmd = /^\\(begin|end)\s*\{[^}]*\}|^\\(?:item|maketitle|tableofcontents|newpage|clearpage|appendix|noindent|medskip|bigskip|smallskip|vspace\*?\s*\{[^}]*\}|hfill)\b(?:\s*\[[^\]]*\])?/.exec(tex.slice(i, i + 80));
      if (cmd) {
        mask.fill(1, i, i + cmd[0].length);
        i += cmd[0].length - 1;
        continue;
      }
      mask.fill(2, i, Math.min(i + 2, to)); // an escaped character, such as \% or \$
      i++;
      continue;
    }
    if (c === "$") {
      const display = tex[i + 1] === "$";
      let j = i + (display ? 2 : 1);
      for (; j < to; j++) {
        if (tex[j] === "\\") j++;
        else if (tex[j] === "$") break;
      }
      const end = Math.min(to, j + (display ? 2 : 1));
      mask.fill(2, i, end);
      i = end - 1;
    }
  }
  return mask;
}

/** A sentence's source as plain words, for reading and for searching. */
export function plainOf(tex: string): string {
  let s = tex
    .replace(/(^|[^\\])%.*$/gm, "$1")
    .replace(new RegExp(`\\\\begin\\s*\\{(${MATH_ENVS})\\*?\\}[\\s\\S]*?\\\\end\\s*\\{\\1\\*?\\}`, "g"), " ")
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, " ")
    .replace(/\$(?:\\.|[^$\\])*\$/g, " ")
    .replace(/\\(?:no)?[a-zA-Z]*cite[a-zA-Z]*\*?(?:\s*\[[^\]]*\]){0,2}\s*\{[^}]*\}/g, " ")
    .replace(/\\(?:label|ref|eqref|autoref|cref|Cref|pageref|url|includegraphics|footnotemark)\*?(?:\s*\[[^\]]*\])?\s*\{[^}]*\}/g, " ")
    .replace(/\\href\s*\{[^}]*\}/g, "");
  // Unwrap formatting commands, keeping their text; drop the rest.
  for (let k = 0; k < 4; k++) s = s.replace(/\\[a-zA-Z]+\*?(?:\s*\[[^\]]*\])?\s*\{([^{}]*)\}/g, "$1");
  return s
    .replace(/\\[a-zA-Z]+\*?/g, " ")
    .replace(/\\(.)/g, "$1")
    .replace(/[{}]/g, "")
    .replace(/~/g, " ")
    .replace(/``|''/g, '"')
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:?!)])/g, "$1")
    .trim();
}

/** Phrases that say a result comes from elsewhere. */
const CUES: [RegExp, string][] = [
  [/\b(?:it )?(?:is|are|was|were|has been|have been) (?:well[- ])?(?:known|established|shown|demonstrated|observed|measured|reported|found|proposed|argued|suggested|predicted|confirmed|derived|studied|used|applied|discussed|investigated|explored|developed|introduced)\b/i, "has been shown"],
  [/\b(?:well[- ]known|widely|commonly|generally|usually|typically|traditionally|conventionally|standard|popular)\b/i, "widely"],
  [/\b(?:previous(?:ly)?|prior|earlier|recent(?:ly)?|past|existing|original(?:ly)?|classic(?:al)?|seminal|pioneering)\b/i, "earlier work"],
  [/\b(?:stud(?:y|ies)|literature|works?|authors|experiments?|observations?|surveys?|measurements?|simulations?|analys[ie]s|data ?sets?|catalogu?es?|collaborations?)\b/i, "studies"],
  [/\b(?:shows?|showed|shown|demonstrat\w+|report\w*|observ\w+|measur\w+|found|finds?|detect\w*|establish\w*|predict\w*|propos\w+|suggest\w*|indicat\w+|confirm\w*|reveal\w*|constrain\w*|rule[sd]? out|exclud\w+)\b/i, "reports"],
  [/\b(?:evidence|consensus|bounds?|limits?|constraints?|tension|discrepanc\w+|anomal\w+|benchmark\w*|state[- ]of[- ]the[- ]art|first)\b/i, "evidence"],
  [/\b(?:according to|following|as in|in line with|consistent with|in agreement with|motivated by|inspired by|based on|known as|so[- ]called|introduced by|due to)\b/i, "according to"],
  [/\bet al\b/i, "et al."],
  [/\b\d+(?:\.\d+)?\s*(?:%|σ|μm|(?:per ?cent|sigma|ev|kev|mev|gev|tev|k|mpc|kpc|pc|hz|khz|mhz|ghz|s|ms|nm|um|mm|cm|km|kg)\b)|\b(?:19|20)\d\d\b/i, "a figure or year"],
];

/** Openings that announce the manuscript's own work, which needs no citation. */
const OWN = /^(?:in (?:this|the present|our) (?:paper|work|letter|article|thesis|chapter|section|note|study|appendix)|here,? we|this (?:paper|work|letter|article|thesis|chapter|section|note) |we (?:now |then |first |next |also |further |thus |therefore )?(?:show|find|present|propose|derive|compute|calculate|obtain|use|consider|define|introduce|assume|denote|write|have|will|study|focus|discuss|summari[sz]e|conclude|describe|argue|demonstrate|apply|perform|construct|develop|test|choose|take|set|fix|refer|turn|begin|start|note|see|expect|plot|show)|our (?:results?|analysis|method|approach|model|findings?|code|data)|(?:fig(?:ure)?s?|tables?|eqs?|equations?|sections?|appendix)\.?\s*\d|(?:as|this is) (?:shown|seen|illustrated|plotted|summari[sz]ed|listed) in (?:fig|table|eq|sec|appendix))/i;

/** How much a sentence reads like a claim that needs a citation, and why. */
export function claimScore(plain: string): { score: number; cues: string[] } {
  const words = plain.split(/\s+/).filter(Boolean);
  if (words.length < 6) return { score: 0, cues: [] };
  if (OWN.test(plain)) return { score: 0, cues: [] };
  if (/\?$/.test(plain)) return { score: 0, cues: [] };
  const cues = CUES.filter(([re]) => re.test(plain)).map(([, label]) => label);
  let score = cues.length;
  // "We" further in still often describes this work; "they" and "these" point elsewhere.
  if (/\b(?:we|our|us)\b/i.test(plain)) score -= 1;
  if (words.length >= 14) score += 0.5;
  return { score: Math.max(0, score), cues };
}

const lineAt = (tex: string, i: number) => {
  let n = 1;
  for (let k = tex.indexOf("\n"); k >= 0 && k < i; k = tex.indexOf("\n", k + 1)) n++;
  return n;
};

/** Every sentence in the draft's text, in order, with where a citation would go. */
export function sentencesOf(tex: string): Sentence[] {
  const mask = maskOf(tex);
  const out: Sentence[] = [];
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    let s = start;
    let e = end;
    while (s < e && /\s/.test(tex[s])) s++;
    while (e > s && (/\s/.test(tex[e - 1]) || mask[e - 1] === 1 || mask[e - 1] === 3)) e--;
    start = -1;
    if (e <= s) return;
    const raw = tex.slice(s, e);
    const plain = plainOf(raw);
    if (plain.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length < 3) return;
    // The citation goes before the closing punctuation, and before closing quotes or brackets around it.
    let at = e;
    while (at > s && /[)\]}'"]/.test(tex[at - 1]) && mask[at - 1] === 0) at--;
    if (/[.?!;:,]/.test(tex[at - 1] ?? "") && mask[at - 1] === 0) at--;
    else at = e;
    const { score, cues } = claimScore(plain);
    out.push({ n: out.length + 1, start: s, end: e, at, line: lineAt(tex, s), tex: raw, plain, cited: CITE.test(raw), score, cues });
  };

  for (let i = 0; i < tex.length; i++) {
    if (mask[i] === 1) {
      close(i);
      continue;
    }
    if (start < 0) {
      if (/\s/.test(tex[i]) || mask[i] === 3) continue;
      start = i;
    }
    // A blank line ends a paragraph.
    if (tex[i] === "\n" && mask[i] === 0) {
      let j = i + 1;
      while (j < tex.length && (tex[j] === " " || tex[j] === "\t" || tex[j] === "\r")) j++;
      if (tex[j] === "\n") {
        close(i);
        continue;
      }
    }
    if (mask[i] !== 0 || !/[.?!]/.test(tex[i])) continue;
    // The sentence ends here if whitespace (or the end) follows, past closing quotes and brackets.
    let j = i + 1;
    while (j < tex.length && /[)\]}'"]/.test(tex[j]) && mask[j] === 0) j++;
    if (j < tex.length && !/\s/.test(tex[j]) && mask[j] !== 1) continue;
    if (mask[j] === 3) continue;
    if (tex[i] === ".") {
      const before = tex.slice(Math.max(0, i - 12), i).match(/([A-Za-z][A-Za-z.]*)$/)?.[1] ?? "";
      if (ABBREV.has(before.toLowerCase()) || /^[A-Z]$/.test(before) || /(?:^|\.)[a-z]$/i.test(before) && before.includes(".")) continue;
      // A decimal point or a version number is not an end.
      if (/\d/.test(tex[i - 1] ?? "") && /\d/.test(tex[i + 1] ?? "")) continue;
    }
    close(j);
  }
  close(tex.length);
  return out;
}

/** The sentences that cite nothing and read like claims, most claim-like first within the draft's order. */
export function uncitedClaims(sentences: Sentence[], min = 1): Sentence[] {
  return sentences.filter((s) => !s.cited && s.score >= min);
}

/** A short search for a sentence: its rarest-looking words, longest first, kept in sentence order. */
export function queryFor(plain: string, max = 7): string {
  const words = terms(plain).filter((w) => !/^\d+$/.test(w));
  const keep = new Set([...words].sort((a, b) => b.length - a.length).slice(0, max));
  return words.filter((w) => keep.has(w)).join(" ");
}

/** The draft with a \cite{…} put into each sentence that has papers chosen, everything else untouched. */
export function applyCites(tex: string, sentences: Sentence[], chosen: Map<number, string[]>, cmd = "cite"): string {
  const edits = sentences
    .filter((s) => chosen.get(s.n)?.length)
    .map((s) => ({ at: s.at, text: `~\\${cmd}{${chosen.get(s.n)!.join(",")}}` }))
    .sort((a, b) => b.at - a.at);
  let out = tex;
  for (const e of edits) {
    // No space is left before the tie.
    let at = e.at;
    while (at > 0 && (out[at - 1] === " " || out[at - 1] === "\t")) at--;
    out = out.slice(0, at) + e.text + out.slice(e.at);
  }
  return out;
}

export interface Triage {
  n: number;
  needs: boolean;
  /** A few words to search the literature with. */
  query?: string;
  why?: string;
}

/** Claude's reading of which sentences need a citation, from a JSON array in its reply. */
export function parseTriage(text: string): Triage[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end < start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as Partial<Triage>[];
    return raw
      .filter((t) => typeof t.n === "number" && typeof t.needs === "boolean")
      .map((t) => ({
        n: t.n!,
        needs: t.needs!,
        query: typeof t.query === "string" && t.query.trim() ? t.query.trim() : undefined,
        why: typeof t.why === "string" && t.why.trim() ? t.why.trim() : undefined,
      }));
  } catch {
    return [];
  }
}

/** The uncited sentences as Claude reads them: numbered, with the sentence before each for context. */
export function triagePrompt(all: Sentence[], ask: Sentence[]): string {
  const byN = new Map(all.map((s) => [s.n, s]));
  return ask
    .map((s) => {
      const prev = byN.get(s.n - 1);
      return `<sentence n="${s.n}">${prev ? `\n<before>${prev.plain}</before>` : ""}\n${s.plain}\n</sentence>`;
    })
    .join("\n\n");
}
