// Check a storage setup before using it: look at the settings for common
// slips, then list, write, read back and remove a small file. When a step
// fails, say what is most likely wrong and how to fix it, in words a person
// (or an AI assistant they paste it into) can act on. Keys never appear in
// the report.

import type { StorageAdapter } from "./types";

export type StepState = "ok" | "failed" | "skipped";

export interface CheckStep {
  id: "settings" | "list" | "write" | "read" | "remove";
  label: string;
  state: StepState;
  detail?: string;
}

export interface Diagnosis {
  /** A short name for what is wrong, e.g. "cors". */
  kind: "cors" | "access" | "bucket" | "endpoint" | "token" | "repo" | "settings" | "unknown";
  title: string;
  fix: string;
}

export interface CheckReport {
  ok: boolean;
  provider: string;
  steps: CheckStep[];
  diagnosis?: Diagnosis;
  /** For a bucket: the CORS rule this site needs, ready to paste. */
  cors?: string;
}

const LABELS: Record<CheckStep["id"], string> = {
  settings: "Look over the settings",
  list: "List the library's files",
  write: "Save a small test file",
  read: "Read it back",
  remove: "Remove the test file",
};

/** The CORS rule a bucket needs so this site (and local development) can use it. */
export function corsRule(origin: string): string {
  const o = JSON.stringify(origin.replace(/\/+$/, ""));
  return `[
  {
    "AllowedOrigins": [${o}],
    "AllowedMethods": ["GET", "PUT", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]`;
}

/** Slips in the settings themselves, found before any request. */
export function lintConfig(provider: string, c: Record<string, string>): Diagnosis | null {
  const v = (k: string) => (c[k] ?? "").trim();
  if (provider === "s3") {
    const missing = [["endpoint", "Endpoint"], ["bucket", "Bucket"], ["accessKeyId", "Access key id"], ["secretAccessKey", "Secret access key"]].filter(([k]) => !v(k)).map(([, l]) => l);
    if (missing.length) return { kind: "settings", title: `Missing: ${missing.join(", ")}`, fix: "Fill these in under Where your library lives, then check again." };
    const endpoint = v("endpoint");
    if (!/^https?:\/\//.test(endpoint)) return { kind: "endpoint", title: "The endpoint needs https://", fix: `Write it as https://${endpoint.replace(/^\/+/, "")}.` };
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      return { kind: "endpoint", title: "The endpoint is not a web address", fix: "For Cloudflare R2 it looks like https://<account id>.r2.cloudflarestorage.com." };
    }
    const path = url.pathname.replace(/\/+$/, "");
    if (path && path.split("/").pop() === v("bucket")) {
      return { kind: "endpoint", title: "The endpoint includes the bucket name", fix: `Use ${url.origin} as the endpoint, and ${v("bucket")} only in Bucket.` };
    }
    if (path) return { kind: "endpoint", title: "The endpoint has a path after the host", fix: `Use just ${url.origin} as the endpoint.` };
    if (url.hostname.endsWith(".r2.dev")) {
      return { kind: "endpoint", title: "That is the bucket's public address, not its S3 endpoint", fix: "Use https://<account id>.r2.cloudflarestorage.com, shown on the R2 overview page, and keep public access off." };
    }
    if (url.hostname.endsWith("r2.cloudflarestorage.com") && v("region") && v("region") !== "auto") {
      return { kind: "settings", title: "R2 uses the region auto", fix: "Set Region to auto (or leave it empty)." };
    }
    if (/\s/.test(c.accessKeyId ?? "") || /\s/.test(c.secretAccessKey ?? "")) {
      return { kind: "settings", title: "A key has a space or line break in it", fix: "Paste the access key id and secret again, without spaces." };
    }
  }
  if (provider === "github") {
    if (!v("repo") || !v("token")) return { kind: "settings", title: "Missing: " + [!v("repo") && "Repository", !v("token") && "Token"].filter(Boolean).join(", "), fix: "Fill these in, then check again." };
    const repo = v("repo").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { kind: "settings", title: "The repository should be owner/name", fix: "For example kausalflow/papers, not a full address." };
    if (repo !== v("repo")) return { kind: "settings", title: "The repository should be owner/name", fix: `Write ${repo}.` };
  }
  return null;
}

/** What an error from a step most likely means. */
export function diagnose(provider: string, step: CheckStep["id"], e: unknown, origin: string): Diagnosis {
  const msg = e instanceof Error ? e.message : String(e);
  const status = Number(/\b(4\d\d|5\d\d)\b/.exec(msg)?.[1] ?? 0);
  if (provider === "s3") {
    // A blocked cross-site request shows up as a bare network error.
    if (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(msg)) {
      return {
        kind: "cors",
        title: "The bucket did not let this site in (CORS), or the endpoint is wrong",
        fix: `Add the CORS rule below to the bucket, with exactly ${origin} as the allowed origin. On Cloudflare: R2 → your bucket → Settings → CORS Policy. If the rule is already there, check the endpoint address.`,
      };
    }
    if (status === 403) {
      return step === "write" || step === "remove"
        ? { kind: "access", title: "The key can read but not write", fix: "Give the key Object Read & Write on this bucket (on R2: Manage API tokens → edit the token)." }
        : { kind: "access", title: "The key was refused (403)", fix: "Check the access key id and secret were copied whole, and that the key covers this bucket. On R2, the token needs Object Read & Write and this bucket under Specify bucket(s)." };
    }
    if (status === 404) return { kind: "bucket", title: "No bucket by that name at this endpoint", fix: "Check the bucket name (it is case-sensitive) and that the endpoint is for the same account." };
    if (status === 400) return { kind: "settings", title: "The bucket refused the request (400)", fix: "Usually the region: use auto for R2, or the bucket's own region (e.g. eu-central-1) for AWS." };
  }
  if (provider === "github") {
    if (status === 401) return { kind: "token", title: "GitHub refused the token (401)", fix: "The token has expired or was revoked, or was not copied whole. Make a new one." };
    if (status === 404) return { kind: "repo", title: "GitHub can't see that repository (404)", fix: "Check owner/name, and that the fine-grained token was given this repository when it was made." };
    if (status === 403) return { kind: "token", title: "The token can read but not write (403)", fix: "Give the token Contents: Read and write on this repository." };
    if (status === 409 || status === 422) return { kind: "repo", title: "GitHub refused the branch", fix: "Check the branch name, or leave it empty for the default branch. An empty repository needs one commit first (add a README on GitHub)." };
  }
  return { kind: "unknown", title: "Something else went wrong", fix: msg };
}

/** Run the checks. `open` makes the adapter from the settings (it may throw). */
export async function checkStorage(provider: string, config: Record<string, string>, open: () => StorageAdapter, origin: string): Promise<CheckReport> {
  const steps: CheckStep[] = (Object.keys(LABELS) as CheckStep["id"][]).map((id) => ({ id, label: LABELS[id], state: "skipped" }));
  const report: CheckReport = { ok: false, provider, steps };
  if (provider === "s3") report.cors = corsRule(origin);
  const mark = (id: CheckStep["id"], state: StepState, detail?: string) => Object.assign(steps.find((s) => s.id === id)!, { state, detail });

  const lint = lintConfig(provider, config);
  if (lint) {
    mark("settings", "failed", lint.title);
    report.diagnosis = lint;
    return report;
  }
  let storage: StorageAdapter;
  try {
    storage = open();
  } catch (e) {
    mark("settings", "failed", (e as Error).message);
    report.diagnosis = { kind: "settings", title: (e as Error).message, fix: "Fill in the missing settings, then check again." };
    return report;
  }
  mark("settings", "ok");

  const probe = `lightkone/.setup-check-${Math.random().toString(36).slice(2, 10)}.txt`;
  const body = new TextEncoder().encode(`Lightkone setup check ${new Date().toISOString()}`);
  let current: CheckStep["id"] = "list";
  try {
    const keys = await storage.list("lightkone/");
    mark("list", "ok", keys.length ? `${keys.length} file${keys.length === 1 ? "" : "s"} in lightkone/` : "Empty so far: a new library starts here");
    current = "write";
    await storage.write(probe, body, "text/plain");
    mark("write", "ok");
    current = "read";
    const back = await storage.read(probe);
    if (!back || new TextDecoder().decode(back) !== new TextDecoder().decode(body)) throw new Error("The file read back differs from the one saved.");
    mark("read", "ok");
    current = "remove";
    if (storage.remove) {
      await storage.remove(probe);
      mark("remove", "ok");
    } else mark("remove", "skipped", "This storage can't remove files");
    report.ok = true;
  } catch (e) {
    mark(current, "failed", (e as Error).message);
    report.diagnosis = diagnose(provider, current, e, origin);
    if (current === "read" || current === "remove") await storage.remove?.(probe).catch(() => undefined);
  }
  return report;
}

/** The report as text to paste into Claude or another assistant. No keys. */
export function reportForAssistant(r: CheckReport, config: Record<string, string>, origin: string, site = `${origin}/`): string {
  const safe = Object.entries(config)
    .filter(([k, v]) => v && !/secret|token|key|password/i.test(k))
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const steps = r.steps.map((s) => `- ${s.state === "ok" ? "✓" : s.state === "failed" ? "✗" : "·"} ${s.label}${s.detail ? `: ${s.detail}` : ""}`).join("\n");
  return [
    "I'm setting up Lightkone, a reference manager that keeps its library in storage I own. Its storage check failed. Please help me fix it, step by step, telling me exactly where to click.",
    "",
    `Site address (the CORS origin): ${origin}`,
    `Storage: ${r.provider === "s3" ? "S3-compatible bucket (Cloudflare R2, AWS S3, MinIO…)" : r.provider === "github" ? "Private GitHub repository" : r.provider}`,
    "Settings (keys left out):",
    safe || "- (none)",
    "",
    "Check:",
    steps,
    r.diagnosis ? `\nLightkone's guess: ${r.diagnosis.title}. ${r.diagnosis.fix}` : "",
    r.cors ? `\nThe CORS rule the bucket needs:\n${r.cors}` : "",
    "",
    `Lightkone's setup docs: ${site}docs/storage.html (all docs as one text file: ${site}llms-full.txt)`,
  ]
    .filter((l) => l !== "")
    .join("\n")
    .replace(/\n(Check:|Settings)/g, "\n\n$1");
}
