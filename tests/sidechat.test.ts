import { describe, expect, it } from "vitest";
import { chatsAbout } from "../src/reader/SideChat";
import type { Entry } from "../src/core/history";

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
