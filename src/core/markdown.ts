// A small Markdown renderer for Claude's answers: paragraphs, headings, lists,
// code, bold and italics, and LaTeX math ($...$, $$...$$, \(...\), \[...\]).
// Everything else is escaped, so the output is safe to put in the page.

export type MathRenderer = (tex: string, display: boolean) => string;

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Math is cut out first, so Markdown never touches what is inside it. */
function inline(text: string, math: MathRenderer): string {
  const parts: string[] = [];
  const re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\s)((?:\\\$|[^$\n])+?)\$(?!\d)|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    parts.push(emphasis(escape(text.slice(last, m.index))));
    if (m[5] !== undefined) parts.push(`<code>${escape(m[5])}</code>`);
    else parts.push(math((m[1] ?? m[2] ?? m[3] ?? m[4]).trim(), m[1] !== undefined || m[2] !== undefined));
    last = re.lastIndex;
  }
  parts.push(emphasis(escape(text.slice(last))));
  return parts.join("");
}

const emphasis = (s: string) => s.replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>");

export function renderMarkdown(md: string, math: MathRenderer): string {
  const out: string[] = [];
  // Display math may contain blank lines: set it aside before splitting into blocks.
  const held: string[] = [];
  const text = md.replace(/\r\n/g, "\n").replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]/g, (m) => `\u0000${held.push(m) - 1}\u0000`);
  for (const raw of text.split(/\n{2,}/)) {
    const block = raw.trim().replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)]);
    if (!block) continue;
    if (block.startsWith("```")) {
      out.push(`<pre><code>${escape(block.replace(/^```\w*\n?/, "").replace(/```$/, ""))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(block);
    if (h && !block.includes("\n")) {
      out.push(`<h4>${inline(h[2], math)}</h4>`);
      continue;
    }
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*([-*]|\d+[.)])\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      const ordered = /^\s*\d/.test(lines[0]);
      const items: string[] = [];
      for (const l of lines) {
        if (/^\s*([-*]|\d+[.)])\s+/.test(l)) items.push(l.replace(/^\s*([-*]|\d+[.)])\s+/, ""));
        else items[items.length - 1] += ` ${l.trim()}`;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((i) => `<li>${inline(i, math)}</li>`).join("")}</${tag}>`);
      continue;
    }
    out.push(`<p>${inline(block, math)}</p>`);
  }
  return out.join("\n");
}

/** Plain fallback while KaTeX loads, or if it cannot. */
export const plainMath: MathRenderer = (tex, display) => (display ? `<div class="math">${escape(tex)}</div>` : `<code>${escape(tex)}</code>`);
