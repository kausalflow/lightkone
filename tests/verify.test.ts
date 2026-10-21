import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtFiles, fingerprints, verify } from "../scripts/verify.mjs";

function build() {
  const dir = mkdtempSync(join(tmpdir(), "lightkone-dist-"));
  mkdirSync(join(dir, "app"));
  writeFileSync(join(dir, "index.html"), "<p>landing</p>");
  writeFileSync(join(dir, "app", "index.html"), "<p>app</p>");
  writeFileSync(join(dir, "_headers"), "/*\n  X-Frame-Options: DENY\n");
  writeFileSync(join(dir, "app", "main.js.map"), "{}");
  return dir;
}

describe("checking a site sends this build", () => {
  it("lists what a browser is sent, not the host's settings or source maps", () => {
    expect(builtFiles(build())).toEqual(["app/index.html", "index.html"]);
  });

  it("prints a fingerprint per file, like sha256sum", () => {
    expect(fingerprints(build())).toMatch(/^[0-9a-f]{64} {2}app\/index\.html\n[0-9a-f]{64} {2}index\.html\n$/);
  });

  it("passes when every file matches, and names the ones that don't", async () => {
    const dir = build();
    const site = new Map([["https://x.test/index.html", "<p>landing</p>"], ["https://x.test/app/index.html", "<p>app</p>"]]);
    const from = (m: Map<string, string>) => async (url: string) => {
      if (!m.has(url)) throw new Error("404 Not Found");
      return Buffer.from(m.get(url)!);
    };
    expect(await verify("https://x.test", dir, from(site))).toEqual([]);
    site.set("https://x.test/app/index.html", "<p>app</p><script src=//evil.test></script>");
    site.delete("https://x.test/index.html");
    expect(await verify("https://x.test/", dir, from(site))).toEqual(["app/index.html: differs", "index.html: 404 Not Found"]);
  });
});
