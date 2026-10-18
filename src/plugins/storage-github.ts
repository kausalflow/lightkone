import type { LightkonePlugin, PaperDraft, StorageAdapter } from "../core/types";
import { parseBibtexToDrafts } from "../core/bibtex";

// A private GitHub repository as storage. Every save is a commit, so the
// library has full history for free. It can also read .bib files that another
// tool keeps in the same repo, such as Paperpile's "Sync to GitHub", and adds
// any paper it has not seen yet: a gentle way to move off Paperpile.

export interface GitHubConfig {
  repo: string; // owner/name
  token: string; // fine-grained token with Contents read/write on this repo only
  branch?: string;
  bibFolder?: string; // folder with .bib files to import, e.g. "paperpile"
  api?: string; // GitHub Enterprise: https://ghe.example.com/api/v3
}

const encoder = new TextEncoder();
// Always fresh in the browser. The server's fetch has no HTTP cache and may not accept the option.
const fresh: RequestInit = typeof window === "undefined" ? {} : { cache: "no-store" };

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function githubStorage(cfg: GitHubConfig): StorageAdapter {
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo ?? "") || !cfg.token) {
    throw new Error("GitHub storage needs a repository as owner/name and a token.");
  }
  const api = (cfg.api || "https://api.github.com").replace(/\/+$/, "");
  const ref = cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : "";
  const contents = (path: string) => `${api}/repos/${cfg.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const headers = (accept = "application/vnd.github+json") => ({
    Authorization: `Bearer ${cfg.token}`,
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub refuses requests without one; browsers add their own.
    ...(typeof window === "undefined" ? { "User-Agent": "Lightkone" } : {}),
  });
  const shaOf = async (path: string): Promise<string | undefined> => {
    // The object media type returns metadata only for large files, which is all we need.
    const r = await fetch(contents(path) + ref, { headers: headers("application/vnd.github.object+json"), ...fresh });
    if (r.status === 404) return undefined;
    if (!r.ok) throw new Error(`GitHub ${r.status} reading ${path}`);
    return (await r.json()).sha;
  };

  const adapter: StorageAdapter = {
    async read(path) {
      const r = await fetch(contents(path) + ref, { headers: headers("application/vnd.github.raw+json"), ...fresh });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`GitHub ${r.status} reading ${path}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async write(path, data) {
      const bytes = typeof data === "string" ? encoder.encode(data) : data;
      const body = {
        message: `Lightkone: update ${path}`,
        content: toBase64(bytes),
        sha: await shaOf(path),
        ...(cfg.branch ? { branch: cfg.branch } : {}),
      };
      const r = await fetch(contents(path), { method: "PUT", headers: headers(), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`GitHub ${r.status} writing ${path}: ${(await r.json().catch(() => ({}))).message ?? ""}`);
    },
    async list(prefix) {
      const dir = prefix.replace(/\/[^/]*$/, "");
      const r = await fetch(contents(dir) + ref, { headers: headers(), ...fresh });
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`GitHub ${r.status} listing ${dir}`);
      const items = (await r.json()) as { path: string; type: string }[];
      return items.filter((i) => i.type === "file" && i.path.startsWith(prefix)).map((i) => i.path);
    },
    async remove(path) {
      const sha = await shaOf(path);
      if (!sha) return;
      const body = { message: `Lightkone: remove ${path}`, sha, ...(cfg.branch ? { branch: cfg.branch } : {}) };
      const r = await fetch(contents(path), { method: "DELETE", headers: headers(), body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`GitHub ${r.status} removing ${path}`);
    },
  };

  if (cfg.bibFolder) {
    const folder = cfg.bibFolder.replace(/^\/+|\/+$/g, "");
    adapter.seed = async () => {
      const files = (await adapter.list(`${folder}/`)).filter((p) => p.endsWith(".bib"));
      const drafts: PaperDraft[] = [];
      for (const f of files) {
        const bytes = await adapter.read(f);
        if (!bytes) continue;
        const collection = f.split("/").pop()!.replace(/\.bib$/, "");
        for (const d of parseBibtexToDrafts(new TextDecoder().decode(bytes))) {
          drafts.push({ ...d, fields: { ...d.fields, "lightkone-source": collection } });
        }
      }
      return drafts;
    };
  }
  return adapter;
}

const plugin: LightkonePlugin = {
  id: "storage-github",
  name: "GitHub repository",
  storage: [
    {
      id: "github",
      label: "Private GitHub repository",
      description: "Every save is a commit, so you get history for free. Can also pick up .bib files that Paperpile or another tool syncs into the same repo.",
      fields: [
        { name: "repo", label: "Repository", placeholder: "owner/name" },
        { name: "token", label: "Token", type: "password", help: "A fine-grained token with Contents read and write on this one repository." },
        { name: "branch", label: "Branch (optional)", placeholder: "main" },
        { name: "bibFolder", label: "Folder of .bib files to import (optional)", placeholder: "paperpile" },
        { name: "api", label: "GitHub Enterprise API URL (optional)", placeholder: "https://github.example.com/api/v3" },
      ],
      create: (c) => githubStorage(c as unknown as GitHubConfig),
    },
  ],
};
export default plugin;
