// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { browserHistoryStore, conversationMarkdown, dayLabel, entryOf, findEntries, focusOf, groupEntries, loadConversation, loadHistory, mergeIndex, newConversationId, organizeConversation, removeConversation, saveConversation, titleOf, topicsOf, type Conversation } from "../src/core/history";
import type { StorageAdapter } from "../src/core/types";

function memory(): StorageAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(p) { return files.has(p) ? new TextEncoder().encode(files.get(p)!) : null; },
    async write(p, d) { files.set(p, typeof d === "string" ? d : new TextDecoder().decode(d)); },
    async list(prefix) { return [...files.keys()].filter((k) => k.startsWith(prefix)); },
    async remove(p) { files.delete(p); },
  };
}

const conv = (id: string, p: Partial<Conversation> = {}): Conversation => ({
  id, kind: "ask", title: `Question ${id}`, created: "2026-10-21T08:00:00Z", updated: "2026-10-21T08:00:00Z", papers: [], preview: "",
  turns: [{ role: "user", text: `Question ${id}` }, { role: "assistant", text: "The flow has a fixed point [1]." }], ...p,
});

describe("history of conversations", () => {
  it("makes ids that sort by time", () => {
    const a = newConversationId(new Date("2026-10-21T08:29:00Z"));
    expect(a).toMatch(/^20261021-0829-[a-z0-9]{1,5}$/);
    expect(newConversationId(new Date("2026-10-22T00:00:00Z")) > a).toBe(true);
  });

  it("keeps each conversation in its own file and lists it, newest first", async () => {
    const s = memory();
    await saveConversation(s, conv("a", { papers: ["p1", "p1"] }));
    const list = await saveConversation(s, conv("b", { updated: "2026-10-21T09:00:00Z" }));
    expect(list.map((e) => e.id)).toEqual(["b", "a"]);
    expect(list[1]).toMatchObject({ papers: ["p1"], preview: "The flow has a fixed point [1]." });
    expect((await loadConversation(s, "a"))?.turns).toHaveLength(2);
    expect((await loadHistory(s)).length).toBe(2);
  });

  it("merges what two devices listed, keeps the newer copy, and doesn't bring back a deleted one", async () => {
    const a = { format: "lightkone-history" as const, version: 1 as const, entries: [entryOf(conv("x")), entryOf(conv("y"))] };
    const b = { format: "lightkone-history" as const, version: 1 as const, entries: [entryOf(conv("x", { title: "newer", updated: "2026-10-21T10:00:00Z" }))], removed: ["y"] };
    const m = mergeIndex(a, b);
    expect(m.entries.map((e) => [e.id, e.title])).toEqual([["x", "newer"]]);
    const s = memory();
    await saveConversation(s, conv("z"));
    expect(await removeConversation(s, "z")).toEqual([]);
    expect(s.files.has("lightkone/history/z.json")).toBe(false);
    await saveConversation(s, conv("w"));
    expect((await loadHistory(s)).map((e) => e.id)).toEqual(["w"]);
  });

  it("finds conversations by words, kind and paper", () => {
    const es = [entryOf(conv("a", { title: "Neutrino mass bounds", papers: ["p1"] })), entryOf(conv("b", { kind: "table", title: "Method, Data" }))];
    expect(findEntries(es, "neutrino").map((e) => e.id)).toEqual(["a"]);
    expect(findEntries(es, "", "table").map((e) => e.id)).toEqual(["b"]);
    expect(findEntries(es, "", "", "p1").map((e) => e.id)).toEqual(["a"]);
  });

  it("writes a conversation as Markdown with citations named", () => {
    const c = conv("a", { sources: [{ n: 1, paperId: "p1", page: 3, text: "" }], turns: [{ role: "user", text: "Q1" }, { role: "assistant", text: "A fixed point [1]." }, { role: "user", text: "Q2" }, { role: "assistant", text: "Yes." }] });
    const md = conversationMarkdown(c, (id, page) => `${id}, p. ${page}`);
    expect(md).toContain("# Question a");
    expect(md).toContain("A fixed point (p1, p. 3).");
    expect(md).toContain("## Q2\n\nYes.");
  });

  it("names days plainly", () => {
    const now = new Date("2026-10-21T12:00:00");
    expect(dayLabel("2026-10-21T08:00:00", now)).toBe("Today");
    expect(dayLabel("2026-10-20T08:00:00", now)).toBe("Yesterday");
  });

  it("keeps a shared library's history in this browser", async () => {
    const s = browserHistoryStore("group1");
    await saveConversation(s, conv("a"));
    expect(localStorage.getItem("lightkone.history.group1:lightkone/history/index.json")).toContain('"a"');
    expect(await s.list("lightkone/history/")).toContain("lightkone/history/a.json");
  });
});

describe("chats gathered and organized", () => {
  it("knows what each chat was about", () => {
    expect(focusOf(conv("a"))).toBe("library");
    expect(focusOf(conv("a", { kind: "beyond" }))).toBe("beyond");
    expect(focusOf(conv("a", { kind: "paper", paperId: "p1", papers: ["p1"] }))).toEqual(["p1"]);
    expect(focusOf(conv("a", { scope: { kind: "picked", ids: ["p2", "p1"] }, papers: ["p1"] }))).toEqual(["p2", "p1"]);
    expect(focusOf(conv("a", { kind: "table", papers: ["p1", "p3"] }))).toEqual(["p1", "p3"]);
  });

  it("groups by the paper or set of papers, the same set in any order together, pinned first", () => {
    const es = [
      entryOf(conv("a", { kind: "paper", paperId: "p1", papers: ["p1"], updated: "2026-10-21T09:00:00Z" })),
      entryOf(conv("b", { kind: "table", papers: ["p2", "p1"] })),
      entryOf(conv("c", { scope: { kind: "picked", ids: ["p1", "p2"] } })),
      entryOf(conv("d", { pinned: true })),
    ];
    const gs = groupEntries(es, "papers", (ids) => ids.join("+"));
    expect(gs.map((g) => g.label)).toEqual(["Pinned", "p1", "p1+p2", "Whole library"]);
    expect(gs[2].entries.map((e) => e.id)).toEqual(["b", "c"]);
    expect(gs[2].papers).toEqual(["p1", "p2"]);
  });

  it("groups by topic, with the untopical last", () => {
    const es = [entryOf(conv("a", { topics: ["RG", "Lattice"] })), entryOf(conv("b")), entryOf(conv("c", { topics: ["RG"] }))];
    expect(groupEntries(es, "topic", String).map((g) => `${g.label}:${g.entries.length}`)).toEqual(["RG:2", "Lattice:1", "No topic:1"]);
    expect(topicsOf(es)).toEqual(["RG", "Lattice"]);
  });

  it("renames, pins and labels, and a later follow-up keeps them", async () => {
    const s = memory();
    await saveConversation(s, conv("a"));
    let list = await organizeConversation(s, "a", { name: "Fixed points", pinned: true, topics: ["RG"] }, "2026-10-21T10:00:00Z");
    expect(list[0]).toMatchObject({ name: "Fixed points", pinned: true, topics: ["RG"] });
    expect(titleOf(list[0])).toBe("Fixed points");
    list = await saveConversation(s, conv("a", { updated: "2026-10-21T11:00:00Z" }));
    expect(list[0]).toMatchObject({ name: "Fixed points", pinned: true, topics: ["RG"] });
    list = await organizeConversation(s, "a", { name: "", pinned: false, topics: [] }, "2026-10-21T12:00:00Z");
    expect(list[0].name).toBeUndefined();
    expect(list[0].pinned).toBeUndefined();
    expect(titleOf(list[0])).toBe("Question a");
  });

  it("finds a chat by its name or topic", () => {
    const es = [entryOf(conv("a", { name: "Renormalization" })), entryOf(conv("b", { topics: ["lattice"] }))];
    expect(findEntries(es, "renorm").map((e) => e.id)).toEqual(["a"]);
    expect(findEntries(es, "", "", undefined, "lattice").map((e) => e.id)).toEqual(["b"]);
  });
});
