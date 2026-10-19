import { describe, expect, it } from "vitest";
import { withOfflineCache, type ByteCache } from "../src/core/offline";
import type { StorageAdapter } from "../src/core/types";

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
let online = true;
let reads = 0;
// Each PDF is 10 bytes; "gone.pdf" isn't in storage.
const written = new Map<string, string>();
const remote: StorageAdapter = {
  async read(p) {
    if (!online) throw new TypeError("Failed to fetch");
    reads++;
    if (written.has(p)) return new TextEncoder().encode(written.get(p)!);
    return p === "gone.pdf" ? null : new Uint8Array(10);
  },
  async write(p, d) {
    if (!online) throw new TypeError("Failed to fetch");
    written.set(p, typeof d === "string" ? d : new TextDecoder().decode(d));
  },
  async list() {
    return [];
  },
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("PDFs kept offline", () => {
  it("downloads them and reads them with no network", async () => {
    online = true;
    const s = withOfflineCache(remote, mapCache());
    const r = await s.keep(["a.pdf", "b.pdf", "gone.pdf", "a.pdf"], 1000);
    expect(r).toEqual({ added: 2, failed: 1, full: false });
    expect([...(await s.kept()).entries()]).toEqual([["a.pdf", 10], ["b.pdf", 10]]);
    online = false;
    expect((await s.read("b.pdf"))?.length).toBe(10);
  });

  it("stops at the limit", async () => {
    online = true;
    const s = withOfflineCache(remote, mapCache());
    const r = await s.keep(["a.pdf", "b.pdf", "c.pdf"], 25);
    expect(r).toEqual({ added: 2, failed: 0, full: true });
    expect((await s.keep(["c.pdf"], 25)).full).toBe(true);
  });

  it("doesn't download what is already here", async () => {
    online = true;
    const s = withOfflineCache(remote, mapCache());
    await s.read("a.pdf");
    await settle();
    reads = 0;
    await s.keep(["a.pdf"], 1000);
    expect(reads).toBe(0);
  });

  it("keeps them while recently opened PDFs come and go, until let go", async () => {
    online = true;
    const cache = mapCache();
    const s = withOfflineCache(remote, cache, 1);
    await s.keep(["trip.pdf"], 1000);
    for (const p of ["1.pdf", "2.pdf"]) {
      await s.read(p);
      await settle();
    }
    expect(cache.m.has("trip.pdf")).toBe(true);
    expect(cache.m.has("1.pdf")).toBe(false);
    expect(cache.m.has("2.pdf")).toBe(true);
    await s.release(["trip.pdf"]);
    expect(cache.m.has("trip.pdf")).toBe(false);
    expect((await s.kept()).size).toBe(0);
  });
});

describe("highlights saved with no network", () => {
  const notes = "lightkone/annotations/p1.json";
  const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

  it("are kept on the device and written once back online", async () => {
    written.clear();
    online = false;
    const s = withOfflineCache(remote, mapCache());
    await s.write(notes, '{"v":2}');
    expect(text(await s.read(notes))).toBe('{"v":2}');
    expect(await s.flush()).toBe(1);
    online = true;
    expect(await s.flush()).toBe(0);
    expect(written.get(notes)).toBe('{"v":2}');
  });

  it("go out before the stored copy is read", async () => {
    written.clear();
    written.set(notes, '{"v":1}');
    online = false;
    const s = withOfflineCache(remote, mapCache());
    await s.write(notes, '{"v":2}');
    online = true;
    expect(text(await s.read(notes))).toBe('{"v":2}');
  });

  it("don't hide other failed saves", async () => {
    online = false;
    const s = withOfflineCache(remote, mapCache());
    await expect(s.write("lightkone/library.json", "{}")).rejects.toThrow(TypeError);
  });
});
