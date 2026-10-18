import { describe, expect, it } from "vitest";
import { bookmarklet, capturedInput } from "../src/core/capture";
import { withOfflineCache, type ByteCache } from "../src/core/offline";
import { parseFound } from "../src/plugins/claude";
import type { StorageAdapter } from "../src/core/types";

describe("capture", () => {
  it("reads what the bookmarklet sends", () => {
    expect(capturedInput("?add=10.1103%2FPhysRevLett.116.061102")).toBe("10.1103/PhysRevLett.116.061102");
    expect(capturedInput("")).toBeNull();
    expect(capturedInput("?q=x")).toBeNull();
  });

  it("finds the identifier in what Android shares", () => {
    expect(capturedInput("?title=Attention&text=" + encodeURIComponent("Look at this https://arxiv.org/abs/1706.03762v7"))).toBe("arxiv.org/abs/1706.03762v7");
    expect(capturedInput("?url=" + encodeURIComponent("https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.116.061102"))).toBe("10.1103/PhysRevLett.116.061102");
    expect(capturedInput("?text=" + encodeURIComponent("See doi 10.1038/nature14539)."))).toBe("10.1038/nature14539");
    expect(capturedInput("?text=" + encodeURIComponent("Great read https://www.sciencedirect.com/science/article/pii/S0370269312008581"))).toBe(
      "https://www.sciencedirect.com/science/article/pii/S0370269312008581",
    );
    expect(capturedInput("?title=" + encodeURIComponent("Some paper title"))).toBe("Some paper title");
  });

  it("builds a bookmarklet that opens this app", () => {
    const b = bookmarklet("https://lightkone.lab.leima.is/");
    expect(b.startsWith("javascript:")).toBe(true);
    const code = decodeURI(b.slice("javascript:".length));
    expect(code).toContain('"https://lightkone.lab.leima.is/"+\'?add=\'');
    expect(() => new Function(code)).not.toThrow();
  });
});

describe("offline copy", () => {
  const mapCache = (): ByteCache & { m: Map<string, Uint8Array> } => {
    const m = new Map<string, Uint8Array>();
    return {
      m,
      get: async (k) => m.get(k) ?? null,
      put: async (k, d) => void m.set(k, d),
      delete: async (k) => void m.delete(k),
      keys: async () => [...m.keys()],
    };
  };
  const bytes = (s: string) => new TextEncoder().encode(s);
  let online = true;
  const remote: StorageAdapter = {
    async read(p) {
      if (!online) throw new TypeError("Failed to fetch");
      return p === "missing" ? null : bytes(p);
    },
    async write() {
      if (!online) throw new TypeError("Failed to fetch");
    },
    async list() {
      if (!online) throw new TypeError("Failed to fetch");
      return ["a"];
    },
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("answers reads from the last copy when the network is gone", async () => {
    online = true;
    const cache = mapCache();
    const s = withOfflineCache(remote, cache);
    await s.read("lightkone/library.json");
    await settle();
    online = false;
    expect(new TextDecoder().decode((await s.read("lightkone/library.json"))!)).toBe("lightkone/library.json");
    expect(s.offline).toBe(true);
    await expect(s.read("never-read")).rejects.toThrow(TypeError);
    await expect(s.write("x", "y")).rejects.toThrow(TypeError);
    expect(await s.list("")).toEqual([]);
  });

  it("keeps only the most recent PDFs", async () => {
    online = true;
    const cache = mapCache();
    const s = withOfflineCache(remote, cache, 2);
    for (const p of ["1.pdf", "2.pdf", "notes.json", "3.pdf", "1.pdf"]) {
      await s.read(p);
      await settle();
    }
    expect([...cache.m.keys()].sort()).toEqual(["1.pdf", "3.pdf", "notes.json"]);
  });
});

describe("Claude's paper finder", () => {
  it("reads the JSON in its reply", () => {
    expect(parseFound('Here it is:\n```json\n{"found": true, "title": "T", "doi": "10.1/x"}\n```')).toEqual({ found: true, title: "T", doi: "10.1/x" });
    expect(parseFound("I could not tell.")).toBeNull();
    expect(parseFound('{"found": false}')).toEqual({ found: false });
  });
});
