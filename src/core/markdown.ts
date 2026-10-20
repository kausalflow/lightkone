// A small Markdown renderer for Claude's answers and saved web pages:
// paragraphs, headings, lists (nested too), quotes, tables, code, links,
// images, bold and italics, and LaTeX math ($...$, $$...$$, \(...\), \[...\]).
// Everything else is escaped, and links and images must be http(s), so the
// output is safe to put in the page.

export type MathRenderer = (tex: string, display: boolean) => string;

export interface MarkdownOptions {
  /** Headings keep their level (# is h2, ## h3, deeper h4); otherwise every heading is a small h4, as in an answer. */
  levels?: boolean;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const LINK = String.raw`\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\s*\)`;

/** Math, code, links and images are cut out first, so emphasis never touches what is inside them. */
function inline(text: string, math: MathRenderer): string {
  const parts: string[] = [];
  const re = new RegExp(
    String.raw`\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)((?:\\\$|[^$\n])+?)\$(?!\d)|` +
      "`([^`]+)`|" +
      String.raw`!\[([^\]]*)\]${LINK}|\[([^\]]+)\]${LINK}`,
    "g",
  );
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    parts.push(emphasis(escape(text.slice(last, m.index))));
    if (m[5] !== undefined) parts.push(`<code>${escape(m[5])}</code>`);
    else if (m[7] !== undefined) parts.push(`<img src="${escape(m[7])}" alt="${escape(m[6])}" loading="lazy" referrerpolicy="no-referrer">`);
    else if (m[9] !== undefined) parts.push(`<a href="${escape(m[9])}" target="_blank" rel="noopener noreferrer">${inline(m[8], math)}</a>`);
    else parts.push(math((m[1] ?? m[2] ?? m[3] ?? m[4]).trim(), m[1] !== undefined || m[2] !== undefined));
    last = re.lastIndex;
  }
  parts.push(emphasis(escape(text.slice(last))));
  return parts.join("");
}

const emphasis = (s: string) =>
  s
    .replace(/\\([*`_#>|-])/g, (_, c) => `&#${c.charCodeAt(0)};`)
    .replace(/\n/g, "<br>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>");

const MARKER = /^(\s*)([-*+]|\d+[.)])\s+/;

/** A list, with deeper-indented items as lists inside the item above them. */
function list(lines: string[], math: MathRenderer): string {
  const base = MARKER.exec(lines[0])?.[1].length ?? 0;
  const items: { text: string; sub: string[] }[] = [];
  for (const l of lines) {
    const m = MARKER.exec(l);
    if (m && m[1].length <= base) items.push({ text: l.slice(m[0].length), sub: [] });
    else if (m && items.length) items[items.length - 1].sub.push(l);
    else if (items.length) {
      const it = items[items.length - 1];
      if (it.sub.length) it.sub[it.sub.length - 1] += ` ${l.trim()}`;
      else it.text += ` ${l.trim()}`;
    }
  }
  const tag = /^\s*\d/.test(lines[0]) ? "ol" : "ul";
  return `<${tag}>${items.map((i) => `<li>${inline(i.text, math)}${i.sub.length ? list(i.sub, math) : ""}</li>`).join("")}</${tag}>`;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());

function table(lines: string[], math: MathRenderer): string {
  const [head, , ...body] = lines;
  const row = (r: string, tag: string) => `<tr>${cells(r).map((c) => `<${tag}>${inline(c, math)}</${tag}>`).join("")}</tr>`;
  return `<div class="md-table"><table><thead>${row(head, "th")}</thead><tbody>${body.map((r) => row(r, "td")).join("")}</tbody></table></div>`;
}

export function renderMarkdown(md: string, math: MathRenderer, opts: MarkdownOptions = {}): string {
  const out: string[] = [];
  // Code and display math may contain blank lines: set them aside before splitting into blocks.
  const held: string[] = [];
  const hold = (m: string) => `\u0000${held.push(m) - 1}\u0000`;
  const text = md
    .replace(/\r\n/g, "\n")
    .replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, hold)
    .replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/g, hold);
  for (const raw of text.split(/\n{2,}/)) {
    const block = raw.replace(/^\s*\n|\s+$/g, "").replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
    if (!block.trim()) continue;
    const trimmed = block.trim();
    if (trimmed.startsWith("```")) {
      out.push(`<pre><code>${escape(trimmed.replace(/^```[^\n]*\n?/, "").replace(/```$/, ""))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h && !trimmed.includes("\n")) {
      const level = opts.levels ? Math.min(h[1].length + 1, 4) : 4;
      out.push(`<h${level}>${inline(h[2].replace(/\s+#+$/, ""), math)}</h${level}>`);
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      out.push("<hr>");
      continue;
    }
    const lines = block.split("\n").filter((l) => l.trim());
    if (lines.every((l) => /^\s*>/.test(l))) {
      out.push(`<blockquote>${renderMarkdown(lines.map((l) => l.replace(/^\s*>\s?/, "")).join("\n"), math, opts)}</blockquote>`);
      continue;
    }
    if (lines.length >= 2 && lines.every((l) => l.trim().startsWith("|")) && /^\s*\|?\s*:?-{2,}/.test(lines[1])) {
      out.push(table(lines, math));
      continue;
    }
    if (MARKER.test(lines[0]) && lines.every((l) => MARKER.test(l) || /^\s{2,}\S/.test(l))) {
      out.push(list(lines, math));
      continue;
    }
    out.push(`<p>${inline(trimmed, math)}</p>`);
  }
  return out.join("\n");
}

/** Plain fallback while KaTeX loads, or if it cannot. */
export const plainMath: MathRenderer = (tex, display) => (display ? `<div class="math">${escape(tex)}</div>` : `<code>${escape(tex)}</code>`);
