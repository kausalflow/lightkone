// A paper's text, extracted from its PDF once (in the reader) and kept next to
// it, so tools without a PDF parser (the MCP server, search) can read it.
// Pages are separated by form feeds, with "[page N]" at the start of each.

export const textPath = (paperId: string) => `lightkone/text/${paperId}.txt`;

export const joinPages = (pages: string[]) => pages.map((t, i) => `[page ${i + 1}]\n${t.trim()}`).join("\n\f\n");

/** Pages `from`..`to` (1-based, inclusive) of a stored text. */
export function pagesOf(text: string, from = 1, to = Infinity): { text: string; pages: number } {
  const all = text.split("\n\f\n");
  return { text: all.slice(Math.max(0, from - 1), to).join("\n\n"), pages: all.length };
}
