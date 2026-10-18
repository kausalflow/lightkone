import type { Paper } from "./types";
import { paperToBibtex } from "./bibtex";

// Formatted citations to paste elsewhere. "Post" is short plain text for
// social media: no markup, math turned into Unicode, one link.

export type CiteStyle = "post" | "apa" | "markdown" | "latex" | "bibtex";

export const CITE_STYLES: { id: CiteStyle; label: string }[] = [
  { id: "post", label: "Post" },
  { id: "apa", label: "APA" },
  { id: "markdown", label: "Markdown" },
  { id: "latex", label: "\\cite" },
  { id: "bibtex", label: "BibTeX" },
];

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", hbar: "ℏ", ell: "ℓ", infty: "∞", partial: "∂", nabla: "∇", times: "×",
  cdot: "·", pm: "±", to: "→", rightarrow: "→", leftarrow: "←", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", approx: "≈",
  sim: "∼", propto: "∝", sqrt: "√", sum: "∑", int: "∫", in: "∈", langle: "⟨", rangle: "⟩", dagger: "†",
};
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", n: "ⁿ", i: "ⁱ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋" };

const script = (s: string, map: Record<string, string>, mark: string) =>
  [...s].every((c) => map[c]) ? [...s].map((c) => map[c]).join("") : `${mark}${s.length > 1 ? `(${s})` : s}`;

/** LaTeX math in a title, as plain Unicode text: "$\Lambda$CDM" → "ΛCDM", "$H_0$" → "H₀". */
export function unicodeMath(text: string): string {
  return text.replace(/\$([^$]+)\$/g, (_, m: string) =>
    m
      .replace(/\\(?:mathrm|mathbf|mathcal|text|rm|bf|it)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\([A-Za-z]+)\s*/g, (all, name: string) => SYMBOLS[name] ?? all)
      .replace(/\^\{([^{}]*)\}|\^(.)/g, (_, a?: string, b?: string) => script((a ?? b)!, SUP, "^"))
      .replace(/_\{([^{}]*)\}|_(.)/g, (_, a?: string, b?: string) => script((a ?? b)!, SUB, "_"))
      .replace(/[{}]/g, "")
      .replace(/\\,|\\ /g, " "),
  );
}

const surname = (a: string) => (a.includes(",") ? a.split(",")[0] : a.split(" ").pop() ?? a).trim();

/** "Vaswani", "Vaswani and Shazeer", "Vaswani et al." */
export function shortAuthors(authors: string[]): string {
  if (!authors.length) return "";
  if (authors.length === 1) return surname(authors[0]);
  if (authors.length === 2) return `${surname(authors[0])} and ${surname(authors[1])}`;
  return `${surname(authors[0])} et al.`;
}

/** "Vaswani, A., Shazeer, N. M." for APA: surname and initials. */
function apaAuthor(a: string): string {
  const [last, first = ""] = a.includes(",") ? a.split(",").map((s) => s.trim()) : [a.split(" ").pop()!, a.split(" ").slice(0, -1).join(" ")];
  const initials = first
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((n) => n.split("-").map((p) => `${p[0]}.`).join("-"))
    .join(" ");
  return initials ? `${last}, ${initials}` : last;
}

function apaAuthors(authors: string[]): string {
  const names = authors.map(apaAuthor);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 20) return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
}

/** The one link a citation carries: the published DOI, then arXiv, then the paper's own link. */
export function linkOf(p: Paper): string | undefined {
  if (p.doi) return `https://doi.org/${p.doi}`;
  if (p.arxiv) return `https://arxiv.org/abs/${p.arxiv}`;
  return p.url || undefined;
}

const venueOf = (p: Paper) => (p.venue && !/^arxiv$/i.test(p.venue) ? p.venue : p.arxiv ? "arXiv" : p.venue);
const end = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

export function cite(p: Paper, style: CiteStyle): string {
  const title = unicodeMath(p.title);
  const link = linkOf(p);
  const venue = venueOf(p);
  switch (style) {
    case "post": {
      const where = [venue, p.year].filter(Boolean).join(" ");
      return [`"${title}"`, shortAuthors(p.authors) && `by ${shortAuthors(p.authors)}`, where && `(${where})`, link].filter(Boolean).join(" ");
    }
    case "apa": {
      const f = p.fields;
      const volume = f.volume ? `, ${f.volume}${f.number ? `(${f.number})` : ""}` : "";
      const pages = f.pages ? `, ${f.pages.replace(/-+/, "–")}` : "";
      return [
        apaAuthors(p.authors) && end(apaAuthors(p.authors)),
        `(${p.year ?? "n.d."}).`,
        end(title),
        venue && `${venue}${volume}${pages}.`,
        link,
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "markdown": {
      const who = [shortAuthors(p.authors), p.year].filter(Boolean).join(", ");
      return `${link ? `[${title}](${link})` : title}${who ? `, ${who}` : ""}`;
    }
    case "latex":
      return `\\cite{${p.key}}`;
    case "bibtex":
      return paperToBibtex(p);
  }
}
