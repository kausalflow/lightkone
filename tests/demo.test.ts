import { beforeEach, describe, expect, it } from "vitest";
import { demoDraft, isDemo, markDemoOffered, wantsDemo } from "../src/core/demo";

// Tests run in Node: a small stand-in for the browser's localStorage.
const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), clear: () => store.clear() },
});

const fresh = { provider: "browser", shared: false, loaded: 0, papers: 0, arriving: false };

describe("example paper", () => {
  beforeEach(() => localStorage.clear());

  it("goes only into a brand-new library in this browser", () => {
    expect(wantsDemo(fresh)).toBe(true);
    expect(wantsDemo({ ...fresh, provider: "s3" })).toBe(false);
    expect(wantsDemo({ ...fresh, shared: true })).toBe(false);
    expect(wantsDemo({ ...fresh, loaded: 3 })).toBe(false);
    expect(wantsDemo({ ...fresh, papers: 1 })).toBe(false);
    expect(wantsDemo({ ...fresh, arriving: true })).toBe(false);
  });

  it("comes once", () => {
    markDemoOffered();
    expect(wantsDemo(fresh)).toBe(false);
  });

  it("is known by its tag and arXiv id", () => {
    const d = demoDraft();
    expect(isDemo({ arxiv: d.arxiv, tags: d.tags! })).toBe(true);
    expect(isDemo({ arxiv: d.arxiv, tags: [] })).toBe(false);
  });
});
