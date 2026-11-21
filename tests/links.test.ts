import { describe, expect, it } from "vitest";
import { keepLink, keptLink, LINKS_PATH } from "../src/core/links";
import type { StorageAdapter } from "../src/core/types";

function memory(): StorageAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (p) => (files.has(p) ? new TextEncoder().encode(files.get(p)!) : null),
    write: async (p, d) => void files.set(p, typeof d === "string" ? d : new TextDecoder().decode(d)),
    list: async () => [],
  };
}

describe("kept addresses", () => {
  const where = JSON.stringify({ provider: "s3", config: { bucket: "papers", secretAccessKey: "SECRET" } });

  it("shows the address made before, for the same storage only", async () => {
    const s = memory();
    expect(await keptLink(s, "opds", where)).toBeNull();
    await keepLink(s, "opds", where, { url: "https://lk.example/opds/u1.long", short: "https://lk.example/opds/abcdefghjk" }, new Date("2026-11-21T13:00:00Z"));
    await keepLink(s, "mcp", where, { url: "https://lk.example/mcp/u1.x" });
    expect(await keptLink(s, "opds", where)).toEqual({ url: "https://lk.example/opds/u1.long", short: "https://lk.example/opds/abcdefghjk", made: "2026-11-21T13:00:00.000Z" });
    expect((await keptLink(s, "mcp", where))?.url).toBe("https://lk.example/mcp/u1.x");
    expect(await keptLink(s, "opds", where.replace("papers", "other"))).toBeNull();
    // The storage settings themselves are never written down.
    expect(s.files.get(LINKS_PATH)).not.toContain("SECRET");
  });

  it("replaces an address with a new one", async () => {
    const s = memory();
    await keepLink(s, "mcp", where, { url: "a" });
    await keepLink(s, "mcp", where, { url: "b" });
    expect((await keptLink(s, "mcp", where))?.url).toBe("b");
  });
});
