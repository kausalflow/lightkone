// Checks that a running Lightkone site sends exactly the app built from this
// source code. Your API keys and storage keys live in the app in your browser,
// so this is how to know the code holding them is the code in this repository:
//   git checkout v0.2.0 && npm ci && npm run build     (the version Help shows)
//   npm run verify -- https://lightkone.pages.dev/
// Every built file must be byte for byte the same.
//   npm run verify -- --list    prints the SHA-256 of every built file; each release publishes this list.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const dist = process.env.LIGHTKONE_DIST ?? new URL("../dist/", import.meta.url).pathname;
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** The built files, relative to dist/: everything a browser is sent, not the host's own settings files. */
export function builtFiles(dir = dist) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  walk(dir);
  // _headers, _redirects and _routes.json configure Cloudflare Pages and are never served.
  return out.filter((f) => !f.split("/").pop().startsWith("_") && !f.endsWith(".map")).sort();
}

/** "sha256  path" for every built file, like sha256sum. */
export function fingerprints(dir = dist) {
  return builtFiles(dir).map((f) => `${sha(readFileSync(join(dir, f)))}  ${f}`).join("\n") + "\n";
}

async function get(url) {
  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Compares every built file with what the site sends; returns the files that differ or are missing. */
export async function verify(site, dir = dist, fetchFile = get) {
  const base = site.endsWith("/") ? site : `${site}/`;
  const bad = [];
  for (const f of builtFiles(dir)) {
    try {
      const live = await fetchFile(new URL(f, base).href);
      if (sha(live) !== sha(readFileSync(join(dir, f)))) bad.push(`${f}: differs`);
    } catch (e) {
      bad.push(`${f}: ${e.message}`);
    }
  }
  return bad;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  if (arg === "--list") {
    process.stdout.write(fingerprints());
  } else if (!arg) {
    console.error("Usage: npm run verify -- <site address> | --list");
    process.exit(2);
  } else {
    const n = builtFiles().length;
    const bad = await verify(arg);
    if (bad.length) {
      console.error(`${arg} does not send this build (${bad.length} of ${n} files):\n  ${bad.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`${arg} sends exactly this build: ${n} files match.`);
  }
}
