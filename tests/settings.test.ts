import { describe, expect, it } from "vitest";
import { exportSettings, importSettings } from "../src/core/settings";

const s = { "storage.provider": "s3", "storage.s3.secretAccessKey": "secret", "pdfs.email": "a@b.org" };

describe("settings backup", () => {
  it("round-trips a plain backup", async () => {
    const text = await exportSettings(s);
    expect(JSON.parse(text).settings).toEqual(s);
    expect(await importSettings(text)).toEqual(s);
  });

  it("encrypts with a passphrase and needs it back", async () => {
    const text = await exportSettings(s, "correct horse");
    expect(text).not.toContain("secret");
    expect(await importSettings(text, "correct horse")).toEqual(s);
    await expect(importSettings(text)).rejects.toThrow(/passphrase/);
    await expect(importSettings(text, "wrong")).rejects.toThrow(/Wrong passphrase/);
  });

  it("refuses other files and drops non-text values", async () => {
    await expect(importSettings("{}")).rejects.toThrow(/not a Lightkone/);
    await expect(importSettings("@article{x,}")).rejects.toThrow(/not a Lightkone/);
    const odd = JSON.stringify({ format: "lightkone-settings", version: 1, settings: { a: "1", b: 2 } });
    expect(await importSettings(odd)).toEqual({ a: "1" });
  });
});
