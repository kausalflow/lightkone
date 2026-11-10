import { describe, expect, it } from "vitest";
import { buildAll, llmsFull, llmsTxt, renderPage, rewriteHref, slug, textFiles } from "../scripts/docs";

describe("documentation site", () => {
  it("links pages to their built files", () => {
    expect(rewriteHref("STORAGE.md#cloudflare-r2")).toBe("storage.html#cloudflare-r2");
    expect(rewriteHref("README.md")).toBe("index.html");
    expect(rewriteHref("https://rclone.org/install/")).toBe("https://rclone.org/install/");
  });

  it("gives headings GitHub's anchors", () => {
    expect(slug("Step 5: check and tidy")).toBe("step-5-check-and-tidy");
    expect(slug("Keeping Paperpile running while you switch")).toBe("keeping-paperpile-running-while-you-switch");
    const { title, html, toc } = renderPage("# Moving\n\n## Step 1: get out\n\nSee [storage](STORAGE.md#aws-s3).\n\n| a | b |\n| - | - |\n| 1 | 2 |\n");
    expect(title).toBe("Moving");
    expect(toc).toEqual([["step-1-get-out", "Step 1: get out"]]);
    expect(html).toContain('href="storage.html#aws-s3"');
    expect(html).toContain('<div class="table"><table>');
  });

  it("builds every page, and every link within the docs lands on a page and heading that exist", () => {
    const pages = buildAll("docs");
    const texts = textFiles("docs");
    expect(pages.has("index.html")).toBe(true);
    const ids = new Map([...pages].map(([f, html]) => [f, new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))]));
    for (const [file, html] of pages) {
      const main = html.slice(html.indexOf("<main>"));
      for (const [, href] of main.matchAll(/href="([^"]+)"/g)) {
        if (/^(https?:|\.\.\/|mailto:)/.test(href)) continue;
        if (/^[A-Z][A-Z0-9-]*\.md$/.test(href)) {
          expect(texts.has(`docs/${href}`), `${file} → ${href}`).toBe(true);
          continue;
        }
        const [to, hash] = href.split("#");
        const target = to || file;
        expect(pages.has(target), `${file} → ${href}`).toBe(true);
        if (hash) expect(ids.get(target)!.has(hash), `${file} → ${href}`).toBe(true);
      }
    }
  });

  it("gives AI assistants a map, every page's Markdown, and all of it in one file", () => {
    const map = llmsTxt("docs");
    expect(map).toMatch(/^# Lightkone\n\n> /);
    expect(map).toContain("- [Set up with AI](docs/SETUP-WITH-AI.md): ");
    expect(map).toContain("- [The command line](docs/CLI.md): ");
    const files = textFiles("docs");
    for (const [, link] of map.matchAll(/\]\((docs\/[^)]+)\)/g)) expect(files.has(link), link).toBe(true);
    const full = llmsFull("docs");
    expect(full).toContain("<!-- docs/STORAGE.md -->");
    expect(full).toContain("# The command line");
    const page = buildAll("docs").get("cli.html")!;
    expect(page).toContain('data-md="CLI.md"');
    expect(page).toContain('href="../llms-full.txt"');
  });
});
