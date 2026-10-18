import type { BibTarget, LibraryFile, Paper } from "./types";

// Safe saves across devices. Before writing library.json, Lightkone reads it
// again; if another device (or Claude through MCP) saved in the meantime, the
// two versions are merged against the one both started from, paper by paper
// and field by field, instead of the later save silently winning. Only when
// both sides changed the same field differently does this device's edit win.

/** JSON with sorted keys, so equal values compare equal whatever order their fields were set in. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const SETS = new Set(["tags", "folders"]);

/** Lists kept as sets: what either side added is in, what either side removed is out. */
function mergeSet(base: string[] = [], ours: string[] = [], theirs: string[] = []): string[] {
  const removed = new Set([...base.filter((x) => !ours.includes(x)), ...base.filter((x) => !theirs.includes(x))]);
  return [...new Set([...ours, ...theirs])].filter((x) => !removed.has(x));
}

function mergePaper(base: Paper, ours: Paper, theirs: Paper): Paper {
  const out: Record<string, unknown> = {};
  const b = base as unknown as Record<string, unknown>;
  const o = ours as unknown as Record<string, unknown>;
  const t = theirs as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(o), ...Object.keys(t), ...Object.keys(b)])) {
    let v: unknown;
    if (SETS.has(k) && (Array.isArray(o[k]) || Array.isArray(t[k]))) v = mergeSet(b[k] as string[], o[k] as string[], t[k] as string[]);
    else v = same(o[k], b[k]) ? t[k] : o[k];
    if (v !== undefined) out[k] = v;
  }
  return out as unknown as Paper;
}

export interface Merged {
  file: LibraryFile;
  /** Papers that took a change made elsewhere. */
  fromThem: number;
}

/**
 * Three-way merge of library files. `base` is the version this device last
 * read or wrote (null when it had none), `ours` what it holds now, `theirs`
 * what is in storage now.
 */
export function mergeLibraries(base: LibraryFile | null, ours: LibraryFile, theirs: LibraryFile): Merged {
  const baseById = new Map((base?.papers ?? []).map((p) => [p.id, p]));
  const oursById = new Map(ours.papers.map((p) => [p.id, p]));
  const theirsById = new Map(theirs.papers.map((p) => [p.id, p]));
  const papers: Paper[] = [];
  let fromThem = 0;

  const pick = (id: string): Paper | null => {
    const b = baseById.get(id);
    const o = oursById.get(id);
    const t = theirsById.get(id);
    if (!b) return o ?? t ?? null; // new on one side (both sides adding the same id cannot happen)
    if (!o) return t && !same(t, b) ? t : null; // removed here: keep it only if changed there
    if (!t) return same(o, b) ? null : o; // removed there: keep it only if changed here
    if (same(o, b)) return t;
    if (same(t, b)) return o;
    return mergePaper(b, o, t);
  };

  // Their order first, then what only this device has, in its order.
  for (const id of new Set([...theirsById.keys(), ...oursById.keys()])) {
    const p = pick(id);
    if (p) papers.push(p);
    if (!same(p, oursById.get(id) ?? null)) fromThem++;
  }

  const bibSync: BibTarget[] | undefined = same(ours.bibSync ?? [], base?.bibSync ?? []) ? theirs.bibSync : ours.bibSync;
  return { file: { format: "lightkone-library", version: 1, papers, ...(bibSync?.length ? { bibSync } : {}) }, fromThem };
}
