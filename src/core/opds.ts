import type { StorageAdapter } from "./types";
import { EREADER_DIR, readSent, type Sent } from "./ereader";
import { xml } from "./epub";

// The e-reader catalog: an OPDS 1.2 feed (Atom) of the papers sent to the
// e-reader, which readers such as the Xteink X4, KOReader and Kobo browse and
// download from. Served at /opds/<address> (functions/opds/), where the
// address carries the library's storage settings, sealed, like the AI app
// address (src/mcp/link.ts). It only reads lightkone/ereader.json and the
// files under lightkone/ereader/.

export const OPDS_TYPE = "application/atom+xml;profile=opds-catalog;kind=acquisition";

/** The feed listing the sent papers, newest first. `self` is the catalog's own address. */
export function opdsFeed(papers: Sent[], self: string, updated = new Date()): string {
  const latest = papers.reduce((t, p) => (p.sent > t ? p.sent : t), "") || updated.toISOString();
  const entries = papers.map((p) => {
    const href = `${self}/${encodeURIComponent(p.id)}.epub`;
    return `<entry>
<title>${xml(p.title)}</title>
<id>urn:lightkone:${xml(p.id)}</id>
<updated>${xml(p.sent)}</updated>
${p.authors.map((a) => `<author><name>${xml(a)}</name></author>`).join("\n")}
${p.year ? `<dc:issued>${p.year}</dc:issued>` : ""}
${p.abstract ? `<summary type="text">${xml(p.abstract)}</summary>` : ""}
<link rel="http://opds-spec.org/acquisition" href="${xml(href)}" type="application/epub+zip" length="${p.size}"/>
</entry>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:opds="http://opds-spec.org/2010/catalog">
<id>urn:lightkone:ereader</id>
<title>Lightkone</title>
<subtitle>Papers sent to your e-reader</subtitle>
<updated>${xml(latest)}</updated>
<author><name>Lightkone</name></author>
<link rel="self" href="${xml(self)}" type="${OPDS_TYPE}"/>
<link rel="start" href="${xml(self)}" type="${OPDS_TYPE}"/>
${entries.join("\n")}
</feed>
`;
}

/** A safe ASCII file name for the download, from the title. */
export function downloadName(p: Sent): string {
  const base = p.title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().split(/\s+/).slice(0, 8).join(" ") || "paper";
  return `${base}.epub`;
}

/**
 * Answers a request under one catalog address. `rest` is what follows the
 * address: "" for the feed, "<paper id>.epub" for a file. `self` is the
 * catalog's full address, for links in the feed.
 */
export async function opdsAnswer(storage: StorageAdapter, rest: string, self: string): Promise<Response> {
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (!rest) {
    let papers: Sent[];
    try {
      papers = await readSent(storage);
    } catch {
      return new Response("The library's storage couldn't be read.", { status: 502, headers });
    }
    return new Response(opdsFeed(papers, self), { headers: { ...headers, "content-type": `${OPDS_TYPE}; charset=utf-8` } });
  }
  const id = /^([^/]+)\.epub$/.exec(decodeURIComponent(rest))?.[1];
  if (!id) return new Response("Not found", { status: 404, headers });
  const papers = await readSent(storage).catch(() => [] as Sent[]);
  const paper = papers.find((p) => p.id === id);
  // Only files the list names, and only under lightkone/ereader/.
  if (!paper || !paper.file.startsWith(EREADER_DIR) || paper.file.includes("..")) return new Response("Not found", { status: 404, headers });
  const bytes = await storage.read(paper.file).catch(() => null);
  if (!bytes) return new Response("Not found", { status: 404, headers });
  return new Response(bytes as BodyInit, {
    headers: {
      ...headers,
      "content-type": "application/epub+zip",
      "content-length": String(bytes.length),
      "content-disposition": `attachment; filename="${downloadName(paper)}"`,
    },
  });
}
