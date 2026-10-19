// Working out which paper a PDF file is, from its own text: most papers print
// their DOI or arXiv id on the first page. What is found is looked up like a
// pasted identifier; when nothing is, the PDF's title or its file name stands in.

const DOI = /\b(10\.\d{4,9}\/[^\s"<>,;]+)/;
// New-style ids (2106.09685v2) as arXiv prints them in the margin, or old-style (hep-th/9711200).
const ARXIV = /arXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/i;

/** A DOI or arXiv id printed in the first pages, ready for the lookups; null when there is none. */
export function identifierIn(pages: string[]): string | null {
  const text = pages.slice(0, 2).join("\n");
  const arxiv = text.match(ARXIV)?.[1];
  if (arxiv) return `arXiv:${arxiv}`;
  const doi = text.match(DOI)?.[1].replace(/[.)\]]+$/, "");
  return doi ?? null;
}

/** A readable title for a PDF nobody could identify: its own title if it has a real one, else the file name. */
export function fallbackTitle(metaTitle: string | undefined, fileName: string): string {
  const t = metaTitle?.trim() ?? "";
  // Many PDFs carry a placeholder such as "untitled", "Microsoft Word - draft.docx" or the file name.
  if (t.length > 8 && !/^(untitled|microsoft word|document\d*|main|paper)\b|\.(pdf|docx?|tex|dvi)$/i.test(t)) return t;
  return fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled PDF";
}
