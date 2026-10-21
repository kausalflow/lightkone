import type { Paper } from "./types";

// Which papers a question, a table or a review draws on: the whole library,
// the folder, tag or search in view, or papers picked one by one.

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

/** The scope a tool opened with last, when it still makes sense. */
export function loadScope(tool: string, allowLiterature = false): Scope {
  try {
    const s = JSON.parse(localStorage.getItem(`${SCOPE_KEY}.${tool}`) || "null") as Scope | null;
    if (s && (s.kind !== "literature" || allowLiterature) && (s.kind !== "picked" || Array.isArray(s.ids))) return s;
  } catch {
    // private window, or nothing kept
  }
  return { kind: "all" };
}

export function saveScope(tool: string, s: Scope) {
  try {
    localStorage.setItem(`${SCOPE_KEY}.${tool}`, JSON.stringify(s));
  } catch {
    // private window
  }
}

/** "12 papers", "1 paper". */
export const papersText = (n: number) => `${n} ${n === 1 ? "paper" : "papers"}`;
