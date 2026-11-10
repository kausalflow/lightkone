import { describe, expect, it } from "vitest";
import { checkStorage, corsRule, lintConfig, reportForAssistant } from "../src/core/storagecheck";
import type { StorageAdapter } from "../src/core/types";

const origin = "https://lightkone.example.org";
const s3 = { endpoint: "https://abc.r2.cloudflarestorage.com", bucket: "papers", region: "auto", accessKeyId: "AKID", secretAccessKey: "s3cret" };

function memory(fail: Partial<Record<"list" | "write" | "read" | "remove", Error>> = {}): StorageAdapter & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async list(p) {
      if (fail.list) throw fail.list;
      return [...files.keys()].filter((k) => k.startsWith(p));
    },
    async write(p, d) {
      if (fail.write) throw fail.write;
      files.set(p, d as Uint8Array);
    },
    async read(p) {
      if (fail.read) throw fail.read;
      return files.get(p) ?? null;
    },
    async remove(p) {
      if (fail.remove) throw fail.remove;
      files.delete(p);
    },
  };
}

describe("storage check", () => {
  it("passes a working store and leaves no test file behind", async () => {
    const m = memory();
    const r = await checkStorage("s3", s3, () => m, origin);
    expect(r.ok).toBe(true);
    expect(r.steps.every((s) => s.state === "ok")).toBe(true);
    expect(m.files.size).toBe(0);
  });

  it("reads a network error from a bucket as CORS and offers the rule", async () => {
    const r = await checkStorage("s3", s3, () => memory({ list: new TypeError("Failed to fetch") }), origin);
    expect(r.ok).toBe(false);
    expect(r.diagnosis?.kind).toBe("cors");
    expect(JSON.parse(r.cors!)[0].AllowedOrigins).toEqual([origin]);
  });

  it("tells a read-only key from a wrong one", async () => {
    const ro = await checkStorage("s3", s3, () => memory({ write: new Error("Storage write failed (403): x") }), origin);
    expect(ro.diagnosis?.title).toMatch(/read but not write/);
    const wrong = await checkStorage("s3", s3, () => memory({ list: new Error("Storage list failed (403)") }), origin);
    expect(wrong.diagnosis?.title).toMatch(/refused/);
    const missing = await checkStorage("s3", s3, () => memory({ list: new Error("Storage list failed (404)") }), origin);
    expect(missing.diagnosis?.kind).toBe("bucket");
  });

  it("explains GitHub answers", async () => {
    const gh = { repo: "me/papers", token: "t" };
    expect((await checkStorage("github", gh, () => memory({ list: new Error("GitHub 401 listing lightkone") }), origin)).diagnosis?.kind).toBe("token");
    expect((await checkStorage("github", gh, () => memory({ list: new Error("GitHub 404 listing lightkone") }), origin)).diagnosis?.kind).toBe("repo");
  });

  it("catches slips in the settings before trying", async () => {
    expect(lintConfig("s3", { ...s3, endpoint: "https://abc.r2.cloudflarestorage.com/papers" })?.title).toMatch(/includes the bucket/);
    expect(lintConfig("s3", { ...s3, endpoint: "abc.r2.cloudflarestorage.com" })?.kind).toBe("endpoint");
    expect(lintConfig("s3", { ...s3, endpoint: "https://pub-123.r2.dev" })?.title).toMatch(/public address/);
    expect(lintConfig("s3", { ...s3, region: "us-east-1" })?.title).toMatch(/auto/);
    expect(lintConfig("s3", { ...s3, secretAccessKey: "" })?.title).toMatch(/Secret access key/);
    expect(lintConfig("github", { repo: "https://github.com/me/papers", token: "t" })?.fix).toMatch(/me\/papers/);
    expect(lintConfig("s3", s3)).toBeNull();
    let opened = false;
    const r = await checkStorage("s3", { ...s3, bucket: "" }, () => ((opened = true), memory()), origin);
    expect(r.steps[0].state).toBe("failed");
    expect(opened).toBe(false);
  });

  it("never puts keys in the text for an assistant", async () => {
    const r = await checkStorage("s3", s3, () => memory({ list: new TypeError("Failed to fetch") }), origin);
    const text = reportForAssistant(r, s3, origin, `${origin}/`);
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("AKID");
    expect(text).toContain("papers");
    expect(text).toContain(`${origin}/llms-full.txt`);
    expect(text).toContain(corsRule(origin));
  });
});
