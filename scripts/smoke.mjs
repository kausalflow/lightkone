// A quick check of a deployed site in a real browser, run after every deploy:
//   node scripts/smoke.mjs https://staging.lightkone.pages.dev/ [commit]
// The landing page, docs and app load; the app opens with its example papers
// and no errors; the services under /api/ answer; and version.json names the
// commit expected (the one just built), so a stale deploy fails.
import { chromium } from "playwright";

const base = (process.argv[2] ?? process.env.BASE_URL ?? "").replace(/\/?$/, "/");
const commit = (process.argv[3] ?? process.env.EXPECT_COMMIT ?? "").slice(0, 7);
if (base === "/") {
  console.error("Usage: node scripts/smoke.mjs <site address> [commit]");
  process.exit(2);
}

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};
const ok = (msg) => console.log(`✓ ${msg}`);

async function status(path, init) {
  const res = await fetch(new URL(path, base), { cache: "no-store", ...init });
  return res;
}

const v = await status("version.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (!v) fail("version.json is missing");
else if (commit && v.commit !== commit) fail(`version.json is ${v.label}, expected commit ${commit}`);
else ok(`version ${v.label}`);

for (const path of ["", "app/", "docs/"]) {
  const r = await status(path);
  if (r.ok) ok(`/${path} answers ${r.status}`);
  else fail(`/${path} answers ${r.status}`);
}
// A service without its parameters answers a JSON error: the Functions are deployed.
const api = await status("api/pdf");
if (api.status >= 400 && api.status < 500 && (api.headers.get("content-type") ?? "").includes("json")) ok(`/api/pdf answers ${api.status} JSON`);
else fail(`/api/pdf answers ${api.status} ${api.headers.get("content-type")}`);

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(new URL("app/", base).href);
  await page.getByText("Attention Is All You Need").first().waitFor({ timeout: 20000 });
  ok("the app opens with its example papers");
  const skip = page.getByRole("button", { name: "Skip" }).first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.getByRole("button", { name: "Chats" }).first().click();
  await page.getByRole("button", { name: "New chat" }).first().waitFor({ timeout: 5000 });
  ok("Chats opens");
  if (errors.length) fail(`errors in the app: ${errors.join("; ")}`);
  else ok("no errors in the app");
} catch (e) {
  fail(`the app: ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}
if (process.exitCode) console.error(`${base} failed the check.`);
else console.log(`${base} passed the check.`);
