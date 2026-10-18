import type { Paper } from "./types";

// Folders are paths ("Physics/QFT"); a paper can sit in several, like
// Paperpile's folders. Saying a paper is in "Physics/QFT" also puts it under
// "Physics" when browsing.

export const cleanFolder = (f: string) =>
  f
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");

/**
 * Folders implied by Paperpile's Drive paths. Paperpile files new PDFs under an
 * author folder ("All Papers/HINTON/...", or "Other" without authors); older
 * libraries filed them by the user's own folders ("All Papers/MLDS/Physics/...").
 */
export function foldersFromPaperpile(file?: string): string[] {
  const out = new Set<string>();
  for (const path of (file ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
    const dirs = path.split("/").slice(0, -1);
    if (dirs[0] === "All Papers") dirs.shift();
    if (!dirs.length) continue;
    if (dirs.length === 1 && (dirs[0] === dirs[0].toUpperCase() || dirs[0] === "Other")) continue;
    out.add(dirs.join("/"));
  }
  return [...out];
}

export interface FolderNode {
  name: string;
  path: string;
  /** Papers in this folder or any folder inside it, outside the trash. */
  count: number;
  children: FolderNode[];
}

export function folderTree(papers: Paper[]): FolderNode[] {
  const root: FolderNode = { name: "", path: "", count: 0, children: [] };
  for (const p of papers) {
    if (p.trashed) continue;
    const seen = new Set<FolderNode>();
    for (const f of p.folders ?? []) {
      let node = root;
      for (const name of f.split("/")) {
        const path = node.path ? `${node.path}/${name}` : name;
        let child = node.children.find((c) => c.name === name);
        if (!child) node.children.push((child = { name, path, count: 0, children: [] }));
        if (!seen.has(child)) {
          child.count++;
          seen.add(child);
        }
        node = child;
      }
    }
  }
  const sort = (ns: FolderNode[]) => {
    ns.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    ns.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

export const allFolders = (papers: Paper[]) => [...new Set(papers.flatMap((p) => p.folders ?? []))].sort((a, b) => a.localeCompare(b));
