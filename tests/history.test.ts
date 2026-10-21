// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { browserHistoryStore, conversationMarkdown, dayLabel, entryOf, findEntries, loadConversation, loadHistory, mergeIndex, newConversationId, removeConversation, saveConversation, type Conversation } from "../src/core/history";
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
