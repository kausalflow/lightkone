import { describe, expect, it } from "vitest";
import { activeStorage, copyPapers, inviteLink, readInvite, sharedLibraries, withShared, type SharedLibrary } from "../src/core/shared";
import { Library } from "../src/core/library";
import type { Paper, StorageAdapter } from "../src/core/types";

function memory(files: Record<string, Uint8Array | string> = {}): StorageAdapter & { files: typeof files } {
  const enc = new TextEncoder();
  return {
    files,
    async read(p) { const v = files[p]; return v === undefined ? null : typeof v === "string" ? enc.encode(v) : v; },
    async write(p, d) { files[p] = d; },
    async list(prefix) { return Object.keys(files).filter((f) => f.startsWith(prefix)); },
  };
}

const group: SharedLibrary = { id: "g1", name: "Cosmology group", provider: "github", config: { repo: "lab/papers", token: "secret-token", branch: "main" } };
const fields = [{ name: "repo", label: "Repository" }, { name: "token", label: "Token", type: "password" as const }, { name: "branch", label: "Branch" }];

describe("shared libraries", () => {
  it("opens one's own library, or the shared one chosen", () => {
    const own = { "storage.provider": "s3", "storage.s3.bucket": "mine" };
    expect(activeStorage(own)).toEqual({ providerId: "s3", config: { bucket: "mine" }, shared: null });
    const s = { ...withShared(own, [group]), "libraries.active": "g1" };
    expect(sharedLibraries(s)).toEqual([group]);
    expect(activeStorage(s)).toEqual({ providerId: "github", config: group.config, shared: group });
    expect(activeStorage({ ...s, "libraries.active": "gone" }).shared).toBeNull();
  });

  it("invites with where the library lives, never the token", () => {
    const link = inviteLink("https://lightkone.lab.leima.is/?open=x#y", group, fields);
    expect(link).not.toContain("secret");
    expect(link.startsWith("https://lightkone.lab.leima.is/?join=")).toBe(true);
    expect(readInvite(new URL(link).search)).toEqual({ name: "Cosmology group", provider: "github", config: { repo: "lab/papers", branch: "main" } });
    expect(readInvite("?join=not-base64!")).toBeNull();
    expect(readInvite(`?join=${btoa(JSON.stringify({ name: "x", provider: "github", config: { repo: "a/b", evil: { nested: 1 } } }))}`)).toEqual({ name: "x", provider: "github", config: { repo: "a/b" } });
  });

  it("copies papers with their PDFs, once, saying who added them", async () => {
    const from = memory({ "papers/All Papers/WILSON/Wilson 1971.pdf": new Uint8Array([37, 80, 68, 70]) });
    const mine = new Library(from);
    mine.merge([{ title: "Renormalization group and critical phenomena", authors: ["Wilson, Kenneth G."], year: 1971, starred: true }]);
    const paper: Paper = { ...mine.papers[0], pdf: "papers/All Papers/WILSON/Wilson 1971.pdf", opened: "2026-01-01" };
    const to = memory();
    expect(await copyPapers([paper], from, to, "L")).toBe(1);
    const shared = new Library(to);
    await shared.load();
    expect(shared.papers[0]).toMatchObject({ title: paper.title, key: paper.key, by: "L", pdf: paper.pdf });
    expect(shared.papers[0].id).not.toBe(paper.id);
    expect(shared.papers[0].starred).toBeUndefined();
    expect(shared.papers[0].opened).toBeUndefined();
    expect(to.files[paper.pdf!]).toEqual(new Uint8Array([37, 80, 68, 70]));
    expect(await copyPapers([paper], from, to, "L")).toBe(0);
  });
});
