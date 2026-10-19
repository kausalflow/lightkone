// The documentation site: docs/*.md rendered into plain pages at docs/<name>.html
// when the app is built (and served on the fly by the dev server). The Markdown
// stays readable on GitHub; links between pages (STORAGE.md#cloudflare-r2)
// become links between the built pages (storage.html#cloudflare-r2).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Marked, type Tokens } from "marked";
import type { Plugin } from "vite";

/** The pages in the order the side bar lists them, by section. */
export const NAV: [string, string[]][] = [
  ["Start here", ["README", "GETTING-STARTED", "PAPERPILE", "STORAGE"]],
  ["Using Lightkone", ["READING", "FINDING", "WRITING", "SHARING", "MCP", "PRIVACY", "FAQ"]],
  ["Running your own", ["HOSTING", "PLUGINS", "ARCHITECTURE"]],
];

/** README.md is the docs' home page; every other page is its name in lower case. */
export const pageFile = (name: string) => (name === "README" ? "index.html" : `${name.toLowerCase()}.html`);

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Links to other Markdown pages point at their built pages; everything else is left alone. */
export function rewriteHref(href: string): string {
  const m = /^([A-Z][A-Z0-9-]*)\.md(#.*)?$/.exec(href);
  return m ? pageFile(m[1]) + (m[2] ?? "") : href;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderPage(md: string): { title: string; html: string; toc: [string, string][] } {
  const toc: [string, string][] = [];
  let title = "Lightkone";
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, { tokens, depth, text }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        if (depth === 1) {
          title = text;
          return `<h1>${inner}</h1>\n`;
        }
        const id = slug(text);
        if (depth === 2) toc.push([id, text]);
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${depth}>\n`;
      },
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, { href, title: t, tokens }: Tokens.Link) {
        const to = rewriteHref(href);
        const external = /^https?:/.test(to);
        return `<a href="${escape(to)}"${t ? ` title="${escape(t)}"` : ""}${external ? ' rel="noopener" target="_blank"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
    },
  });
  // Wide tables scroll inside the page instead of widening it, on a phone.
  const html = (marked.parse(md, { async: false }) as string).replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>");
  return { title, html, toc };
}

function titleOf(dir: string, name: string): string {
  const first = /^#\s+(.+)$/m.exec(readFileSync(join(dir, `${name}.md`), "utf8"));
  return first ? first[1].trim() : name;
}

export function buildPage(dir: string, name: string): string {
  const { title, html, toc } = renderPage(readFileSync(join(dir, `${name}.md`), "utf8"));
  const nav = NAV.map(
    ([section, names]) =>
      `<p class="nav-head">${section}</p><ul>${names
        .map((n) => `<li><a href="${pageFile(n)}"${n === name ? ' aria-current="page"' : ""}>${escape(n === "README" ? "Overview" : titleOf(dir, n))}</a></li>`)
        .join("")}</ul>`,
  ).join("");
  const onThisPage = toc.length > 2 ? `<nav class="toc" aria-label="On this page"><p class="nav-head">On this page</p><ul>${toc.map(([id, t]) => `<li><a href="#${id}">${escape(t)}</a></li>`).join("")}</ul></nav>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Lightkone documentation</title>
<link rel="icon" href="../icon.svg" type="image/svg+xml">
<script>try{var t=localStorage.getItem("lightkone.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="index.html"><img src="../icon.svg" alt="" width="26" height="26"> Lightkone <span>docs</span></a>
  <details class="menu"><summary>Pages</summary><nav aria-label="Documentation">${nav}</nav></details>
  <a class="open" href="../app/">Open Lightkone</a>
</header>
<div class="wrap">
  <nav class="side" aria-label="Documentation">${nav}</nav>
  <main>${html}<p class="edit"><a href="https://github.com/kausalflow/lightkone/blob/main/docs/${name}.md" rel="noopener" target="_blank">This page on GitHub</a></p></main>
  ${onThisPage}
</div>
</body>
</html>
`;
}

/** Every page in docs/, named by its built file. */
export function buildAll(dir: string): Map<string, string> {
  const listed = NAV.flatMap(([, names]) => names);
  const present = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
  const missing = listed.filter((n) => !present.includes(n));
  if (missing.length) throw new Error(`docs: no file for ${missing.join(", ")}`);
  return new Map(listed.map((n) => [pageFile(n), buildPage(dir, n)]));
}

/** Vite: write the pages into the build, and serve them in development. */
export function docsSite(dir = "docs"): Plugin {
  return {
    name: "lightkone-docs",
    generateBundle() {
      for (const [file, html] of buildAll(dir)) this.emitFile({ type: "asset", fileName: `docs/${file}`, source: html });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/docs\/(?:([a-z0-9-]+\.html))?(?:[?#].*)?$/.exec(req.url ?? "");
        if (!m) return next();
        const page = buildAll(dir).get(m[1] ?? "index.html");
        if (!page) return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(page);
      });
    },
  };
}

const CSS = `
:root{--bg:#f6f5f1;--panel:#fff;--sunken:#efede7;--text:#1b1f2a;--muted:#5f6777;--line:#e5e2da;--accent:#3350c4;--code:#efece5;
--sans:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--serif:"Iowan Old Style","Charter","Source Serif 4","Palatino Linotype","Noto Serif",Georgia,serif;--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1218;--panel:#161a22;--sunken:#12151c;--text:#e8eaef;--muted:#9ba3b3;--line:#242a35;--accent:#93adff;--code:#1f242e;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0f1218;--panel:#161a22;--sunken:#12151c;--text:#e8eaef;--muted:#9ba3b3;--line:#242a35;--accent:#93adff;--code:#1f242e;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 var(--sans)}
a{color:var(--accent)}
.top{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:12px;padding:10px 20px;background:var(--bg);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:8px;color:inherit;text-decoration:none;font-weight:620}
.brand span{color:var(--muted);font-weight:400}
.open{margin-left:auto;padding:6px 12px;border-radius:8px;background:var(--accent);color:var(--bg);text-decoration:none;font-size:14px;font-weight:560;white-space:nowrap}
.menu{display:none}
.wrap{display:grid;grid-template-columns:230px minmax(0,760px) 200px;gap:40px;max-width:1280px;margin:0 auto;padding:0 20px}
.side,.toc{position:sticky;top:64px;align-self:start;max-height:calc(100vh - 64px);overflow:auto;padding:24px 0;font-size:14px}
.side ul,.toc ul,.menu ul{list-style:none;margin:0 0 14px;padding:0}
.side li a,.toc li a,.menu li a{display:block;padding:4px 10px;border-radius:6px;color:var(--muted);text-decoration:none}
.side li a:hover,.toc li a:hover{color:var(--text);background:var(--sunken)}
.side a[aria-current],.menu a[aria-current]{color:var(--text);background:var(--sunken);font-weight:560}
.nav-head{margin:0 0 4px;padding:0 10px;font-size:11px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
main{padding:28px 0 80px;min-width:0}
main h1{font:600 34px/1.2 var(--serif);letter-spacing:-.01em;margin:8px 0 18px}
main h2{font:600 24px/1.3 var(--serif);margin:44px 0 10px;padding-top:18px;border-top:1px solid var(--line)}
main h3{font-size:17px;margin:28px 0 6px}
h2,h3{scroll-margin-top:72px;position:relative}
.anchor{position:absolute;left:-1em;width:1em;color:var(--muted);text-decoration:none;opacity:0}
h2:hover .anchor,h3:hover .anchor{opacity:1}
main li{margin:4px 0}
code{font:0.88em var(--mono);background:var(--code);padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
pre{background:var(--code);padding:14px 16px;border-radius:10px;overflow:auto;line-height:1.5}
pre code{background:none;padding:0;overflow-wrap:normal}
.table{overflow-x:auto;margin:14px 0}
table{border-collapse:collapse;font-size:14.5px;min-width:100%}
th,td{text-align:left;vertical-align:top;padding:8px 12px;border-bottom:1px solid var(--line)}
th{font-weight:600;background:var(--sunken)}
.edit{margin-top:48px;font-size:14px}
.edit a{color:var(--muted)}
@media (max-width:1100px){.wrap{grid-template-columns:220px minmax(0,1fr)}.toc{display:none}}
@media (max-width:760px){
  .wrap{display:block;padding:0 16px}
  .side{display:none}
  .top{padding:10px 16px}
  .menu{display:block}
  .menu summary{cursor:pointer;padding:6px 10px;border:1px solid var(--line);border-radius:8px;font-size:14px;list-style:none}
  .menu summary::-webkit-details-marker{display:none}
  .menu nav{position:absolute;left:16px;right:16px;top:calc(100% + 6px);max-height:70vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 6px;box-shadow:0 12px 40px rgb(0 0 0 / .18)}
  .brand span{display:none}
  main h1{font-size:28px}
  main h2{font-size:21px}
}
`;
