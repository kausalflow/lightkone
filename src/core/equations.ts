import type { Paper, StorageAdapter } from "./types";

// Search by equation: the displayed equations of each arXiv paper in the
// library, taken from its LaTeX source, and a search that finds an equation
// however it was spaced, braced or named. Kept in lightkone/equations.json.

export const EQUATIONS_PATH = "lightkone/equations.json";
const PER_PAPER = 300;
const LONGEST = 400;

export interface EquationStore {
  format: "lightkone-equations";
  version: 1;
  /** By paper id. An empty list: the source had none, or arXiv has only a PDF. */
  papers: Record<string, { arxiv: string; at: string; equations: string[] }>;
}

export const emptyEquations = (): EquationStore => ({ format: "lightkone-equations", version: 1, papers: {} });

const decoder = new TextDecoder();

export async function loadEquations(storage: StorageAdapter): Promise<EquationStore> {
  const raw = await storage.read(EQUATIONS_PATH).catch(() => null);
  if (!raw) return emptyEquations();
  try {
    const s = JSON.parse(decoder.decode(raw)) as EquationStore;
    return s.format === "lightkone-equations" ? s : emptyEquations();
  } catch {
    return emptyEquations();
  }
}

export const saveEquations = (storage: StorageAdapter, s: EquationStore) => storage.write(EQUATIONS_PATH, JSON.stringify(s), "application/json");

const bare = (id: string) => id.replace(/^arxiv:/i, "").replace(/v\d+$/, "");

/** arXiv papers whose equations have not been read yet. */
export const toIndex = (papers: Paper[], s: EquationStore) => papers.filter((p) => p.arxiv && !p.trashed && !s.papers[p.id]);

/** Simple macros a paper defines, \newcommand{\R}{\mathbb{R}} or \def\R{...}, without arguments. */
function macros(tex: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\\(?:(?:re)?newcommand\*?\s*\{?\s*(\\[A-Za-z]+)\s*\}?|def\s*(\\[A-Za-z]+|\\[^A-Za-z\s\\]))\s*\{/g;
  for (let m = re.exec(tex); m; m = re.exec(tex)) {
    const body = group(tex, m.index + m[0].length - 1);
    if (body !== null && !/#\d/.test(body) && body.length < 200) out.set(m[1] ?? m[2], body);
  }
  return out;
}

/** The contents of the brace group opening at `at`. */
function group(s: string, at: number): string | null {
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    if (s[i] === "\\") i++;
    else if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return s.slice(at + 1, i);
  }
  return null;
}

const ROWS = /^(align|eqnarray|gather|multline|flalign|split)/;
const SUB = /\\begin\{(split|aligned|gathered)\}|\\end\{(split|aligned|gathered)\}|\\eqalign(no)?\s*\{/;

/** The displayed equations of LaTeX source, each row of an align on its own, macros expanded once. */
export function extractEquations(tex: string): string[] {
  const code = tex.replace(/(^|[^\\])%.*$/gm, "$1");
  const defs = macros(code);
  const expand = (s: string) =>
    defs.size ? s.replace(/\\[A-Za-z]+|\\[^A-Za-z\s\\]/g, (m) => (defs.has(m) ? defs.get(m)! : m)) : s;
  const out: string[] = [];
  const add = (raw: string, rows: boolean) => {
    let body = raw;
    // \eqalign{a &= b \cr c &= d}: its rows, without the group.
    for (let m = /\\eqalign(?:no)?\s*\{/.exec(body); m; m = /\\eqalign(?:no)?\s*\{/.exec(body)) {
      const inner = group(body, m.index + m[0].length - 1);
      if (inner === null) break;
      body = body.slice(0, m.index) + inner + body.slice(m.index + m[0].length + inner.length + 1);
    }
    for (const part of rows ? body.split(/\\\\(?:\[[^\]]*\])?|\\cr(?![A-Za-z])/) : [body]) {
      const eq = expand(part)
        .replace(/\\(label|tag)\*?\{[^}]*\}|\\nonumber|\\notag|\\eqno\s*\S*|\\eqalign(no)?|\\begin\{(split|aligned|gathered)\}|\\end\{(split|aligned|gathered)\}/g, "")
        .replace(/&/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (eq.length >= 3 && eq.length <= LONGEST && !out.includes(eq)) out.push(eq);
    }
  };
  const env = /\\begin\{((?:equation|align|eqnarray|gather|multline|flalign|displaymath|math)\*?)\}([\s\S]*?)\\end\{\1\}/g;
  for (let m = env.exec(code); m; m = env.exec(code)) add(m[2], ROWS.test(m[1]) || SUB.test(m[2]));
  // Some papers take \[ and \] for brackets: then only $$ … $$.
  const display = defs.has("\\[") ? /\$\$([\s\S]*?)\$\$/g : /\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
  for (const m of code.matchAll(display)) add(m[1] ?? m[2], SUB.test(m[1] ?? m[2]));
  // Plain TeX with harvmac, as many older hep-th papers: \eqn\name{...}.
  for (const m of code.matchAll(/\\eqn\s*\\[A-Za-z]+\s*\{/g)) {
    const body = group(code, m.index! + m[0].length - 1);
    if (body) add(body, SUB.test(body));
  }
  return out.slice(0, PER_PAPER);
}

// --- Matching ---

const SPACING = /~|\\(?:[,;:!> ]|quad|qquad|left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|displaystyle|textstyle|limits|nolimits|thinspace|medspace|thickspace|negthinspace)(?![A-Za-z])|\\hspace\*?\{[^}]*\}/g;
const SAME: Record<string, string> = { "\\dfrac": "\\frac", "\\tfrac": "\\frac", "\\varepsilon": "\\epsilon", "\\varphi": "\\phi", "\\vartheta": "\\theta", "\\ell": "l", "\\cdot": "", "\\times": "\\times", "\\rm": "", "\\mathrm": "", "\\operatorname": "", "\\text": "", "\\mathit": "", "\\le": "\\leq", "\\ge": "\\geq", "\\ne": "\\neq", "\\to": "\\rightarrow" };

/** {a \over b} as \frac{a}{b}, as plain TeX wrote fractions. */
export function overToFrac(latex: string): string {
  let s = latex;
  for (let n = 0; n < 100; n++) {
    const at = s.search(/\\over(?![A-Za-z])/);
    if (at < 0) break;
    let open = -1;
    for (let i = at - 1, depth = 0; i >= 0; i--) {
      if (s[i] === "}" && s[i - 1] !== "\\") depth++;
      else if (s[i] === "{" && s[i - 1] !== "\\" && depth-- === 0) {
        open = i;
        break;
      }
    }
    let close = s.length;
    for (let i = at + 5, depth = 0; i < s.length; i++) {
      if (s[i] === "{" && s[i - 1] !== "\\") depth++;
      else if (s[i] === "}" && s[i - 1] !== "\\" && depth-- === 0) {
        close = i;
        break;
      }
    }
    // The group's own braces go: {a \over b} is \frac{a}{b}.
    const frac = `\\frac{${s.slice(open + 1, at).trim()}}{${s.slice(at + 5, close).trim()}}`;
    s = open >= 0 && close < s.length ? s.slice(0, open) + frac + s.slice(close + 1) : s.slice(0, open + 1) + frac + s.slice(close);
  }
  return s;
}

/** LaTeX as tokens: commands, single characters, digits; spacing and sizing dropped, \mathrm{d} as d. */
export function tokens(latex: string): string[] {
  const s = overToFrac(latex).replace(SPACING, " ").replace(/\\(?:mathrm|text|operatorname|rm|mathit)\s*\{([^{}]*)\}/g, "$1");
  const out: string[] = [];
  for (const m of s.matchAll(/\\[A-Za-z]+|\\.|\d+(?:\.\d+)?|[^\s]/g)) {
    const t = m[0] in SAME ? SAME[m[0]] : m[0];
    if (t) out.push(t);
  }
  // Braces around one token say nothing: x^{2} is x^2.
  const flat: string[] = [];
  for (let i = 0; i < out.length; i++) {
    if (out[i] === "{" && out[i + 2] === "}" && out[i + 1] !== "{" && out[i + 1] !== "}") {
      flat.push(out[i + 1]);
      i += 2;
    } else flat.push(out[i]);
  }
  return flat;
}

/** Tokens with each letter renamed by order of first use, so E = mc^2 and F = ma^2 look alike. */
export function skeleton(toks: string[]): string[] {
  const names = new Map<string, string>();
  return toks.map((t) => (/^[A-Za-z]$|^\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|rho|sigma|tau|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Sigma|Phi|Psi|Omega)$/.test(t) ? (names.get(t) ?? names.set(t, `v${names.size}`).get(t)!) : t));
}

/** Overlapping runs of three tokens. */
const grams = (t: string[]) => {
  const out = new Set<string>();
  if (t.length < 3) out.add(t.join(" "));
  for (let i = 0; i + 3 <= t.length; i++) out.add(`${t[i]} ${t[i + 1]} ${t[i + 2]}`);
  return out;
};

export interface EquationHit {
  paperId: string;
  arxiv: string;
  equation: string;
  /** 1 when every part of the query is in the equation as written. */
  score: number;
  /** Matched only with the letters renamed. */
  renamed: boolean;
}

/**
 * The equations cut into overlapping runs of three tokens, with, for each run,
 * the equations that have it, as written and with letters renamed. Built once
 * per session and added to as papers are read, so a search only looks at
 * equations sharing something with the query.
 */
class EquationIndex {
  entries: { paperId: string; arxiv: string; equation: string; length: number }[] = [];
  exact = new Map<string, number[]>();
  shape = new Map<string, number[]>();
  /** Papers in the index, with when they were read. */
  read = new Map<string, string>();

  /** Whether a paper was read again or dropped since: then the index starts over. */
  stale(s: EquationStore): boolean {
    return [...this.read].some(([id, at]) => s.papers[id]?.at !== at);
  }

  /** Papers read since the index was last brought up to date. */
  todo(s: EquationStore): string[] {
    return Object.keys(s.papers).filter((id) => !this.read.has(id));
  }

  add(id: string, entry: EquationStore["papers"][string]) {
    if (this.read.has(id)) return;
    this.read.set(id, entry.at);
    for (const equation of entry.equations) {
      const t = tokens(equation);
      const n = this.entries.push({ paperId: id, arxiv: entry.arxiv, equation, length: t.length }) - 1;
      for (const g of grams(t)) (this.exact.get(g) ?? this.exact.set(g, []).get(g)!).push(n);
      for (const g of grams(skeleton(t))) (this.shape.get(g) ?? this.shape.set(g, []).get(g)!).push(n);
    }
  }

  /** For each equation sharing a run with the query, the share of the query's runs it has. */
  private share(post: Map<string, number[]>, q: Set<string>): Map<number, number> {
    const out = new Map<number, number>();
    for (const g of q) for (const n of post.get(g) ?? []) out.set(n, (out.get(n) ?? 0) + 1 / q.size);
    return out;
  }

  search(query: string, max: number, perPaper: number, min: number): EquationHit[] {
    const q = tokens(query);
    if (!q.length) return [];
    const exact = this.share(this.exact, grams(q));
    const shape = this.share(this.shape, grams(skeleton(q)));
    const byPaper = new Map<string, EquationHit[]>();
    for (const n of new Set([...exact.keys(), ...shape.keys()])) {
      const e = this.entries[n];
      const ex = Math.min(1, exact.get(n) ?? 0);
      // With letters renamed almost anything short looks alike: it counts only when nearly all of it is there, and for less.
      const sameShape = ex < 1 ? Math.min(1, shape.get(n) ?? 0) : 0;
      const sh = sameShape >= 0.9 ? 0.85 * sameShape : 0;
      const score = Math.max(ex, sh);
      if (score < min) continue;
      // Of two equations holding the query, the one closer to it in length comes first.
      const fit = 0.1 * Math.min(1, (q.length + 4) / e.length);
      const list = byPaper.get(e.paperId) ?? byPaper.set(e.paperId, []).get(e.paperId)!;
      list.push({ paperId: e.paperId, arxiv: e.arxiv, equation: e.equation, score: 0.9 * score + fit, renamed: sh > ex });
    }
    return [...byPaper.values()]
      .flatMap((list) => list.sort((a, b) => b.score - a.score).slice(0, perPaper))
      .sort((a, b) => b.score - a.score)
      .slice(0, max);
  }
}

const indexes = new WeakMap<EquationStore, EquationIndex>();

function indexOf(s: EquationStore): EquationIndex {
  let index = indexes.get(s);
  if (!index || index.stale(s)) indexes.set(s, (index = new EquationIndex()));
  return index;
}

/**
 * Bring the search index up to date without holding up the page: a few
 * hundred papers at a time, letting the browser draw in between. Only papers
 * read since the last time are added.
 */
export async function prepareEquations(s: EquationStore, onProgress?: (done: number, total: number) => void): Promise<void> {
  const index = indexOf(s);
  const todo = index.todo(s);
  for (let i = 0; i < todo.length; i++) {
    index.add(todo[i], s.papers[todo[i]]);
    if (i % 50 === 49) {
      onProgress?.(i + 1, todo.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  if (todo.length) onProgress?.(todo.length, todo.length);
}

/** Equations like the query, best first, at most a few per paper. */
export function searchEquations(s: EquationStore, query: string, opts: { max?: number; perPaper?: number; min?: number } = {}): EquationHit[] {
  const { max = 30, perPaper = 3, min = 0.5 } = opts;
  const index = indexOf(s);
  for (const id of index.todo(s)) index.add(id, s.papers[id]);
  return index.search(query, max, perPaper, min);
}

/** Read the equations of papers not yet indexed, one at a time, through /api/tex. */
export async function indexEquations(
  papers: Paper[],
  s: EquationStore,
  o: { fetch?: typeof fetch; signal?: AbortSignal; onProgress?(done: number, total: number): void; onBatch?(): Promise<void> },
): Promise<number> {
  const todo = toIndex(papers, s);
  let done = 0;
  for (const p of todo) {
    if (o.signal?.aborted) break;
    const arxiv = bare(p.arxiv!);
    const r = await (o.fetch ?? fetch)(`api/tex?arxiv=${encodeURIComponent(arxiv)}`, { signal: o.signal });
    if (r.status === 429 || r.status >= 500) throw new Error(`arXiv is busy (${r.status}). What was read so far is kept; try again later.`);
    const body = r.ok ? ((await r.json()) as { equations?: string[] }) : { equations: [] };
    s.papers[p.id] = { arxiv, at: new Date().toISOString(), equations: (body.equations ?? []).slice(0, PER_PAPER) };
    done++;
    o.onProgress?.(done, todo.length);
    if (done % 20 === 0) await o.onBatch?.();
  }
  await o.onBatch?.();
  return done;
}
