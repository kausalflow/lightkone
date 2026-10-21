// The release a build came from: the package version, the date of the commit
// and its short hash, e.g. "0.1.0 · 2026-10-21 · ec1bee0". It is shown in the
// app (Settings and Help) and written to version.json at the site's root, so
// the installed app and the live site can be compared at a glance.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

export interface BuildVersion {
  version: string;
  commit: string;
  date: string;
  label: string;
}

const git = (args: string[]) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, TZ: "UTC" } }).trim();
  } catch {
    return "";
  }
};

export function buildVersion(root = process.cwd()): BuildVersion {
  const version = JSON.parse(readFileSync(`${root}/package.json`, "utf8")).version ?? "0.0.0";
  const sha = git(["rev-parse", "HEAD"]) || process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || "";
  const commit = sha.slice(0, 7);
  const date = git(["log", "-1", "--date=format-local:%Y-%m-%d", "--format=%cd"]) || new Date().toISOString().slice(0, 10);
  // Uncommitted changes are marked, so a local build is never mistaken for a release.
  const dirty = commit && git(["status", "--porcelain", "--untracked-files=no"]) ? "+" : "";
  const label = [version, date, commit ? commit + dirty : "local"].join(" · ");
  return { version, commit, date, label };
}

/** Puts the version in the app as __LIGHTKONE_VERSION__ and writes version.json next to the landing page. */
export function versionStamp(): Plugin {
  const v = buildVersion();
  return {
    name: "lightkone-version",
    config: () => ({ define: { __LIGHTKONE_VERSION__: JSON.stringify(v) } }),
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify(v, null, 2) + "\n" });
    },
  };
}
