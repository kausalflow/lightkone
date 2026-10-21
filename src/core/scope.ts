import type { Paper } from "./types";

// Which papers a question, a table or a review draws on: papers added one by
// one, starting from one. Every paper Claude reads costs the user's own API
// credit, so nothing takes the whole library at once. "all" and "view" are
// only read from chats kept before, and carry on as the papers they used.

export type Scope = { kind: "all" } | { kind: "view" } | { kind: "picked"; ids: string[] } | { kind: "literature" };

export const SCOPE_KEY = "lightkone.scope";

/** The papers in a scope. "literature" is outside the library, so it has none here. */
export function scoped(papers: Paper[], scope: Scope, inView: Paper[]): Paper[] {
  const live = papers.filter((p) => !p.trashed);
  switch (scope.kind) {
    case "all":
      return live;
    case "view":
      return inView.filter((p) => !p.trashed);
    case "picked": {
      const ids = new Set(scope.ids);
      return live.filter((p) => ids.has(p.id));
    }
    case "literature":
      return [];
  }
}

/** The paper a new chat starts with when none is given: the one last opened in view, else the newest in view, else in the library. */
export function firstPaper(papers: Paper[], inView: Paper[]): string[] {
  const pool = inView.filter((p) => !p.trashed).length ? inView.filter((p) => !p.trashed) : papers.filter((p) => !p.trashed);
  if (!pool.length) return [];
  const best = pool.reduce((a, b) => ((b.opened ?? "") > (a.opened ?? "") || (!a.opened && !b.opened && b.added > a.added) ? b : a));
  return [best.id];
}

/**
 * The scope a chat starts or carries on with. Papers given win; a kept chat
 * keeps its own (a whole-library or in-view one becomes the papers it used);
 * otherwise a question beyond the library is remembered, and anything else
 * starts from one paper.
 */
export function startScope(o: { kept?: Scope; keptPapers?: string[]; pick?: string[]; tool: string; first: () => string[] }): Scope {
  if (o.kept) return o.kept.kind === "all" || o.kept.kind === "view" ? { kind: "picked", ids: o.keptPapers ?? [] } : o.kept;
  if (o.pick?.length) return { kind: "picked", ids: o.pick };
  try {
    const s = JSON.parse(localStorage.getItem(`${SCOPE_KEY}.${o.tool}`) || "null") as Scope | null;
    if (s?.kind === "literature") return s;
  } catch {
    // private window, or nothing kept
  }
  return { kind: "picked", ids: o.first() };
}

/** Remembers only whether Ask looks beyond the library; papers are chosen afresh each chat. */
export function saveScope(tool: string, s: Scope) {
  try {
    localStorage.setItem(`${SCOPE_KEY}.${tool}`, JSON.stringify(s.kind === "literature" ? s : { kind: "picked", ids: [] }));
  } catch {
    // private window
  }
}

/** "12 papers", "1 paper". */
export const papersText = (n: number) => `${n} ${n === 1 ? "paper" : "papers"}`;
