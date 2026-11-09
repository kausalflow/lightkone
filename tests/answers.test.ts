import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageAdapter } from "../src/core/types";
import { answerPath, recall, remember, requestKey, setAnswerStore } from "../src/core/answers";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { create } };
  },
}));

function memoryStore(): StorageAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(path) {
      const v = files.get(path);
      return v === undefined ? null : new TextEncoder().encode(v);
    },
    async write(path, data) {
      files.set(path, typeof data === "string" ? data : new TextDecoder().decode(data));
    },
    async list(prefix) {
      return [...files.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

const settings = { "claude.apiKey": "sk-test" };
const paper = { id: "p1", key: "a2020", type: "article", title: "A paper", authors: ["A, B"], tags: [], fields: {}, added: "" } as never;
const reply = (text: string) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });

describe("the key of a request", () => {
  it("is the same for the same request, and changes with the question, the model or the PDF", async () => {
    const req = (q: string, model = "m", pdf = "QUJD") => ({ model, messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", data: pdf } }, { type: "text", text: q }] }] });
    const k = await requestKey(req("why?"));
    expect(await requestKey(req("why?"))).toBe(k);
    expect(await requestKey(req("how?"))).not.toBe(k);
    expect(await requestKey(req("why?", "n"))).not.toBe(k);
    expect(await requestKey(req("why?", "m", "REVG"))).not.toBe(k);
  });

  it("leaves out pictures and cache marks, which differ with zoom and don't change the answer", async () => {
    const req = (img: string, cache: boolean) => ({ model: "m", messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", data: img } }, { type: "text", text: "Explain this", ...(cache ? { cache_control: { type: "ephemeral" } } : {}) }] }] });
    expect(await requestKey(req("AAAA", true))).toBe(await requestKey(req("BBBB", false)));
  });
});

describe("saved answers", () => {
  beforeEach(() => {
    create.mockReset();
  });

  it("are kept in storage and read back on another visit", async () => {
    const store = memoryStore();
    setAnswerStore(store);
    await remember("k1", "summary", "m", "the answer", "2026-11-01T10:00:00Z");
    expect(JSON.parse(store.files.get(answerPath("k1"))!)).toMatchObject({ format: "lightkone-answer", kind: "summary", value: "the answer" });
    setAnswerStore(memoryStore());
    setAnswerStore(store); // a new visit: nothing in memory
    expect((await recall<string>("k1"))?.value).toBe("the answer");
    expect(await recall("k2")).toBeNull();
  });

  it("answer the same request without asking Claude again, until asked afresh", async () => {
    const store = memoryStore();
    setAnswerStore(store);
    const { sortCitations } = await import("../src/plugins/claude");
    create.mockResolvedValueOnce(reply("first"));

    expect(await sortCitations(settings, paper, "[1] cites it")).toBe("first");
    expect(create).toHaveBeenCalledTimes(1);
    expect([...store.files.keys()].some((k) => k.startsWith("lightkone/answers/"))).toBe(true);

    let at: string | undefined;
    expect(await sortCitations(settings, paper, "[1] cites it", undefined, { onSaved: (a) => (at = a) })).toBe("first");
    expect(create).toHaveBeenCalledTimes(1);
    expect(at).toBeTruthy();

    // Other citations are another request.
    create.mockResolvedValueOnce(reply("other"));
    expect(await sortCitations(settings, paper, "[1] cites it differently")).toBe("other");
    expect(create).toHaveBeenCalledTimes(2);

    // Again, on purpose: asks, and the new answer replaces the saved one.
    create.mockResolvedValueOnce(reply("second"));
    expect(await sortCitations(settings, paper, "[1] cites it", undefined, { fresh: true })).toBe("second");
    expect(await sortCitations(settings, paper, "[1] cites it")).toBe("second");
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("are not kept when Claude declines or fails", async () => {
    setAnswerStore(memoryStore());
    const { checkSupport } = await import("../src/plugins/claude");
    create.mockResolvedValueOnce({ stop_reason: "refusal", content: [], stop_details: {} });
    await expect(checkSupport(settings, "a claim", "[1] text")).rejects.toThrow(/declined/);
    create.mockResolvedValueOnce(reply("[]"));
    expect(await checkSupport(settings, "a claim", "[1] text")).toBe("[]");
    expect(create).toHaveBeenCalledTimes(2);
  });
});
