import { describe, expect, it } from "vitest";
import { chatsAbout } from "../src/reader/SideChat";
import { chatSize, isLong, joinChat, type Conversation, type Entry } from "../src/core/history";

const e = (id: string, kind: Entry["kind"], papers: string[], updated: string): Entry => ({ id, kind, title: id, created: updated, updated, papers, preview: "" });

describe("the reader's chats about a paper", () => {
  it("lists chats and explanations started from the paper, newest first", () => {
    const entries = [
      e("old", "paper", ["p1"], "2026-11-01T10:00:00Z"),
      e("explain", "explain", ["p1"], "2026-11-05T10:00:00Z"),
      e("other", "paper", ["p2", "p1"], "2026-11-06T10:00:00Z"),
      e("ask", "ask", ["p1", "p3"], "2026-11-07T10:00:00Z"),
      e("new", "paper", ["p1", "p4"], "2026-11-08T10:00:00Z"),
    ];
    expect(chatsAbout(entries, "p1").map((x) => x.id)).toEqual(["new", "explain", "old"]);
    expect(chatsAbout(entries, "p9")).toEqual([]);
  });
});

describe("one running chat per paper", () => {
  const run = { ...e("run", "paper", ["p1"], "2026-11-08T10:00:00Z"), turns: [{ role: "user", text: "Q1" }, { role: "assistant", text: "A1" }] } as Conversation;
  const explain: Conversation["turns"] = [{ role: "user", text: "Explain this, from page 3" }, { role: "assistant", text: "It means X." }];

  it("adds an explanation at the end, then replaces it with its follow-ups", () => {
    const first = joinChat(run, explain, "2026-11-09T10:00:00Z")!;
    expect(first.conv.turns.map((t) => t.text)).toEqual(["Q1", "A1", "Explain this, from page 3", "It means X."]);
    expect(first.conv.updated).toBe("2026-11-09T10:00:00Z");
    expect(first.part).toEqual({ chat: "run", start: 2, len: 2 });
    // A question asked in the side panel meanwhile stays after it.
    const later = { ...first.conv, turns: [...first.conv.turns, { role: "user", text: "Q2" }, { role: "assistant", text: "A2" }] } as Conversation;
    const more = joinChat(later, [...explain, { role: "user", text: "Why?" }, { role: "assistant", text: "Because." }], "2026-11-09T10:05:00Z", first.part)!;
    expect(more.conv.turns.map((t) => t.text)).toEqual(["Q1", "A1", "Explain this, from page 3", "It means X.", "Why?", "Because.", "Q2", "A2"]);
  });

  it("doesn't add the same answer twice (a saved summary asked again)", () => {
    expect(joinChat(run, [{ role: "user", text: "Summarize this paper." }, { role: "assistant", text: "A1" }], "2026-11-09T10:00:00Z")).toBeNull();
  });

  it("turns an old explanation into a running chat", () => {
    const old = { ...run, kind: "explain" } as Conversation;
    expect(joinChat(old, explain, "2026-11-09T10:00:00Z")!.conv.kind).toBe("paper");
  });
});

describe("a long chat", () => {
  it("counts messages and the text sent again", () => {
    expect(chatSize([{ text: "abcd" }, { text: "abcdefgh", sources: "abcd" }])).toEqual({ messages: 2, tokens: 4 });
  });
  it("is long from 20 messages or about 15k tokens of text", () => {
    expect(isLong({ messages: 19, tokens: 14_999 })).toBe(false);
    expect(isLong({ messages: 20, tokens: 100 })).toBe(true);
    expect(isLong({ messages: 4, tokens: 15_000 })).toBe(true);
  });
});
