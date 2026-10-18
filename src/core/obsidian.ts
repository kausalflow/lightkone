import type { Paper } from "./types";
import { sortHighlights, type Highlight } from "./annotations";
import { linkOf } from "./cite";

// Obsidian export: one Markdown note per paper, named @citekey.md like the
// Obsidian citation plugins do, with the record in YAML properties, the
// paper's notes, and each highlight as a quote that opens Lightkone at its
// page. Anything written below the marker line in Obsidian is kept when the
// note is exported again.

export const KEEP_MARKER = "%% Lightkone updates everything above this line. Your notes below it are kept. %%";

const yamlString = (s: string) => JSON.stringify(s.replace(/\s+/g, " ").trim());

/** Where a link opens the paper in Lightkone, at a page when given. */
export function openLink(app: string, p: Paper, page?: number): string {
  const u = new URL(app);
  u.search = "";
  u.hash = "";
  u.searchParams.set("open", p.id);
  if (page) u.searchParams.set("page", String(page));
  return u.toString();
}

/** A file name Obsidian, Windows and macOS all accept. */
export function noteName(p: Paper): string {
  return `@${p.key.replace(/[\\/:*?"<>|#^[\]]/g, "_")}.md`;
}

const tagOf = (t: string) => t.trim().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_/-]/gu, "");

export function obsidianNote(p: Paper, highlights: Highlight[], app: string, kept = ""): string {
  const props: string[] = ["---", `title: ${yamlString(p.title)}`];
  if (p.authors.length) props.push("authors:", ...p.authors.map((a) => `  - ${yamlString(a)}`));
  if (p.year) props.push(`year: ${p.year}`);
  if (p.venue) props.push(`venue: ${yamlString(p.venue)}`);
  props.push(`citekey: ${yamlString(p.key)}`);
  if (p.doi) props.push(`doi: ${yamlString(p.doi)}`);
  if (p.arxiv) props.push(`arxiv: ${yamlString(p.arxiv)}`);
  const link = linkOf(p);
  if (link) props.push(`url: ${yamlString(link)}`);
  props.push(`lightkone: ${yamlString(openLink(app, p))}`);
  const tags = [...new Set(["paper", ...p.tags.map(tagOf)].filter(Boolean))];
  props.push("tags:", ...tags.map((t) => `  - ${t}`), "---", "");

  const body = [`# ${p.title}`, ""];
  body.push([p.authors.length > 3 ? `${p.authors[0].split(",")[0]} et al.` : p.authors.map((a) => a.split(",")[0]).join(", "), p.year, p.venue].filter(Boolean).join(" · "), "");
  body.push(`[Open in Lightkone](${openLink(app, p)})${link ? ` · [Source](${link})` : ""}`, "");
  if (p.abstract?.trim()) body.push("## Abstract", "", p.abstract.trim(), "");
  if (p.notes?.trim()) body.push("## Notes", "", p.notes.trim(), "");
  if (highlights.length) {
    body.push("## Highlights", "");
    for (const h of sortHighlights(highlights)) {
      body.push(`> [!quote] [p. ${h.page}](${openLink(app, p, h.page)})`, ...h.text.trim().split(/\n+/).map((l) => `> ${l}`), "");
      if (h.note?.trim()) body.push(h.note.trim(), "");
    }
  }
  return [...props, ...body, KEEP_MARKER, kept.replace(/^\n+/, "\n") || "\n"].join("\n");
}

/** What the researcher wrote below the marker in an earlier export. */
export function keptPart(existing: string | null): string {
  if (!existing) return "";
  const at = existing.indexOf(KEEP_MARKER);
  return at < 0 ? "" : existing.slice(at + KEEP_MARKER.length);
}

// A plain zip (stored, not compressed) for browsers that cannot write to a folder.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; text: string }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
  let at = 0;
  for (const b of all) { out.set(b, at); at += b.length; }
  return out;
}
