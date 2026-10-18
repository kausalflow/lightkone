import { describe, expect, it } from "vitest";
import { renderMarkdown, type MathRenderer } from "../src/core/markdown";

const m: MathRenderer = (tex, display) => `[${display ? "D" : "I"}:${tex}]`;

describe("renderMarkdown", () => {
  it("keeps math away from Markdown and escapes the rest", () => {
    expect(renderMarkdown("Here $a_i * b_i$ and **bold** <b>x</b>", m)).toBe("<p>Here [I:a_i * b_i] and <strong>bold</strong> &#60;b&#62;x&#60;/b&#62;</p>");
    expect(renderMarkdown("Cost is $5 and $10 dollars", m)).not.toContain("[I:");
  });

  it("handles display math across blank lines and the \\[ \\] forms", () => {
    const out = renderMarkdown("Start\n\n$$\na = b\n\nc = d\n$$\n\nend \\(x\\) and \\[y\\]", m);
    expect(out).toContain("[D:a = b\n\nc = d]");
    expect(out).toContain("[I:x]");
    expect(out).toContain("[D:y]");
  });

  it("renders lists, headings and code", () => {
    expect(renderMarkdown("- one $x$\n- two\n  more", m)).toBe("<ul><li>one [I:x]</li><li>two more</li></ul>");
    expect(renderMarkdown("1. a\n2. b", m)).toBe("<ol><li>a</li><li>b</li></ol>");
    expect(renderMarkdown("## Title", m)).toBe("<h4>Title</h4>");
    expect(renderMarkdown("```\n<x> $y$\n```", m)).toBe("<pre><code>&#60;x&#62; $y$\n</code></pre>");
    expect(renderMarkdown("use `a*b*c` here", m)).toBe("<p>use <code>a*b*c</code> here</p>");
  });
});
