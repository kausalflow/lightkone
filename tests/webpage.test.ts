// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { fetchPage, linkDraft, linkOnlyReason, markdownFile, pageDraft, PageError, pageMarkdown, paperIdentifier, personName, toMarkdown, isWebLink } from "../src/core/webpage";
import { renderMarkdown, type MathRenderer } from "../src/core/markdown";
import { sandboxedHtml } from "../src/reader/PageReader";
import { charsetOf, handle, isPublicUrl } from "../functions/api/page";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");
const m: MathRenderer = (tex, display) => `[${display ? "D" : "I"}:${tex}]`;

const BLOG = `<!doctype html><html><head>
<title>Putting Earth AI to work | Google Research Blog</title>
<meta property="og:site_name" content="Google Research Blog">
<meta name="description" content="How geospatial models help.">
<meta property="article:published_time" content="2025-07-30T10:00:00Z">
<meta name="author" content="Ada Lovelace">
<link rel="canonical" href="/blog/earth-ai">
</head><body>
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<article>
<h1>Putting Earth AI to work</h1>
<p>Geospatial <strong>foundation</strong> models, described in <a href="https://arxiv.org/abs/2501.00001">our paper</a>, use $x^2$ and <em>more</em>.</p>
<h2>Results</h2>
<ul><li>Floods <ul><li>Rivers</li></ul></li><li>Fires</li></ul>
<blockquote><p>A quote.</p></blockquote>
<pre><code>def f(x):
    return x  # *kept*</code></pre>
<p><img src="/img/map.png" alt="A map"></p>
<table><tr><th>Model</th><th>Score</th></tr><tr><td>A</td><td>0.9</td></tr></table>
<p>Display: <span class="katex-display"><span class="katex"><math><semantics><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span></span></p>
<script>alert(1)</script>
</article>
<footer>Copyright</footer>
</body></html>`;

describe("web page metadata", () => {
  it("reads title, author, date, site and summary", () => {
    const d = pageDraft(doc(BLOG), "https://research.example.com/blog/earth-ai?utm=x");
    expect(d).toMatchObject({
      type: "misc",
      title: "Putting Earth AI to work",
      authors: ["Lovelace, Ada"],
      year: 2025,
      venue: "Google Research Blog",
      abstract: "How geospatial models help.",
      url: "https://research.example.com/blog/earth-ai",
    });
    expect(d.fields?.urldate).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  it("finds a paper's DOI or arXiv id in citation tags", () => {
    expect(paperIdentifier(doc('<meta name="citation_doi" content="doi:10.1103/PhysRev.47.777">'))).toBe("10.1103/PhysRev.47.777");
    expect(paperIdentifier(doc('<meta name="citation_arxiv_id" content="2106.09685">'))).toBe("arXiv:2106.09685");
    expect(paperIdentifier(doc(BLOG))).toBeNull();
  });

  it("names people as Last, First", () => {
    expect(personName("Ada  Lovelace")).toBe("Lovelace, Ada");
    expect(personName("Lovelace, Ada")).toBe("Lovelace, Ada");
    expect(personName("Plato")).toBe("Plato");
  });

  it("tells web links from other input", () => {
    expect(isWebLink("https://example.com/post")).toBe(true);
    expect(isWebLink("https://example.com/paper.pdf")).toBe(false);
    expect(isWebLink("attention is all you need")).toBe(false);
  });
});

describe("web page to Markdown", () => {
  it("keeps the article's structure, math and links, and drops scripts", async () => {
    const md = await pageMarkdown(doc(BLOG), "https://research.example.com/blog/earth-ai");
    expect(md).toContain("**foundation**");
    expect(md).toContain("[our paper](https://arxiv.org/abs/2501.00001)");
    expect(md).toContain("$x^2$");
    expect(md).toContain("*more*");
    expect(md).toMatch(/## Results/);
    expect(md).toContain("- Floods\n  - Rivers\n- Fires");
    expect(md).toContain("> A quote.");
    expect(md).toContain("```\ndef f(x):\n    return x  # *kept*\n```");
    expect(md).toContain("![A map](https://research.example.com/img/map.png)");
    expect(md).toContain("| Model | Score |\n| --- | --- |\n| A | 0.9 |");
    expect(md).toContain("$$\nE = mc^2\n$$");
    expect(md).not.toContain("alert");
    expect(md).not.toContain("Copyright");
  });

  it("keeps the spaces around bold text and links outside the marks", () => {
    expect(toMarkdown(doc('<p><b>A new</b> <a href="/r"><b>report</b></a><b> on maps:</b> text</p>').body, "https://x.org/")).toBe("**A new** [**report**](https://x.org/r) **on maps:** text");
  });

  it("escapes what would read as Markdown", () => {
    expect(toMarkdown(doc("<p>a * b and `c`</p>").body, "https://x.org/")).toBe("a \\* b and \\`c\\`");
  });

  it("renders back to safe HTML with the levels kept", async () => {
    const md = markdownFile({ title: "Putting Earth AI to work", authors: ["Lovelace, Ada"], url: "https://x.org/p" }, await pageMarkdown(doc(BLOG), "https://x.org/p"), new Date("2026-10-20"));
    expect(md).toMatch(/^# Putting Earth AI to work\n\nAda Lovelace\n\nSaved from \[https:\/\/x.org\/p\]\(https:\/\/x.org\/p\) on 2026-10-20\./);
    const html = renderMarkdown(md, m, { levels: true });
    expect(html).toContain("<h2>Putting Earth AI to work</h2>");
    expect(html).toContain("<h3>Results</h3>");
    expect(html).toContain('<a href="https://arxiv.org/abs/2501.00001" target="_blank" rel="noopener noreferrer">our paper</a>');
    expect(html).toContain("<ul><li>Floods<ul><li>Rivers</li></ul></li><li>Fires</li></ul>");
    expect(html).toContain("<blockquote><p>A quote.</p></blockquote>");
    expect(html).toContain("<pre><code>def f(x):\n    return x  # *kept*\n</code></pre>");
    expect(html).toContain('<img src="https://x.org/img/map.png" alt="A map"');
    expect(html).toContain("<th>Model</th>");
    expect(html).toContain("[D:E = mc^2]");
    expect(html).toContain("[I:x^2]");
  });

  it("never makes a script link", () => {
    expect(renderMarkdown("[x](javascript:alert(1)) ![y](data:image/png;base64,AA)", m)).not.toMatch(/href=|src=/);
  });
});

describe("the saved page in a sandbox", () => {
  it("resolves links against where it came from and opens them outside", () => {
    expect(sandboxedHtml('<html><head><base href="/x/"><title>t</title></head></html>', "https://x.org/p")).toBe(
      '<html><head><base href="https://x.org/p" target="_blank"><title>t</title></head></html>',
    );
  });
});

describe("the page service", () => {
  it("only fetches public web addresses", () => {
    expect(isPublicUrl("https://example.com/a")).toBe(true);
    for (const bad of ["http://localhost/", "http://127.0.0.1/", "http://[::1]/", "https://example.com:8443/", "ftp://example.com/", "http://intranet/", "https://a.internal/", "https://user:pw@example.com/"])
      expect(isPublicUrl(bad), bad).toBe(false);
  });

  it("reads the charset a page declares", () => {
    expect(charsetOf("text/html; charset=ISO-8859-1", "")).toBe("ISO-8859-1");
    expect(charsetOf("text/html", '<meta charset="windows-1252">')).toBe("windows-1252");
    expect(charsetOf("text/html", "")).toBe("utf-8");
    expect(charsetOf("text/html; charset=nonsense", "")).toBe("utf-8");
  });

  it("answers JSON, checks each redirect, and refuses what isn't a page", async () => {
    const pages: Record<string, Response> = {
      "https://a.org/old": new Response(null, { status: 301, headers: { location: "https://a.org/new" } }),
      "https://a.org/new": new Response("<p>café</p>", { headers: { "content-type": "text/html; charset=utf-8" } }),
      "https://a.org/bad": new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
      "https://a.org/file": new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
    };
    const f = (async (u: string) => pages[u]) as unknown as typeof fetch;
    const ok = await handle(new Request("https://site/api/page?url=" + encodeURIComponent("https://a.org/old")), f);
    expect(ok.headers.get("content-type")).toMatch(/json/);
    expect(await ok.json()).toEqual({ url: "https://a.org/new", html: "<p>café</p>" });
    expect((await handle(new Request("https://site/api/page?url=" + encodeURIComponent("https://a.org/bad")), f)).status).toBe(400);
    expect((await handle(new Request("https://site/api/page?url=" + encodeURIComponent("https://a.org/file")), f)).status).toBe(415);
    expect((await handle(new Request("https://site/api/page?url=http%3A%2F%2Flocalhost%2F"), f)).status).toBe(400);
  });

  it("says why a site refused, with a status Cloudflare doesn't replace with its own page", async () => {
    const pages: Record<string, Response> = {
      "https://press.example.edu/ideas/x": new Response("<title>Just a moment...</title>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } }),
      "https://a.org/down": new Response("", { status: 500 }),
      "https://a.org/gone": new Response("", { status: 404 }),
    };
    const f = (async (u: string) => {
      if (u.startsWith("https://nowhere")) throw new TypeError("fetch failed");
      return pages[u];
    }) as unknown as typeof fetch;
    const ask = (u: string) => handle(new Request("https://site/api/page?url=" + encodeURIComponent(u)), f);

    const blocked = await ask("https://press.example.edu/ideas/x");
    expect(blocked.status).toBe(424);
    const body = await blocked.json();
    expect(body.blocked).toBe(true);
    expect(body.error).toMatch(/press\.example\.edu turned the page reader away \(it answered 403 with a "checking your browser" page\)/);

    const down = await ask("https://a.org/down");
    expect(down.status).toBe(424);
    expect((await down.json()).error).toMatch(/a\.org answered 500, a problem on its side/);
    expect((await ask("https://a.org/gone")).status).toBe(404);

    const unreachable = await ask("https://nowhere.example/");
    expect(unreachable.status).toBe(424);
    expect((await unreachable.json()).error).toBe("Couldn't reach nowhere.example. Check the link.");
  });
});

describe("a page that can't be read", () => {
  it("passes on the service's reason, and explains an answer that isn't the service's", async () => {
    const answer = (r: Response) => (async () => r) as unknown as typeof fetch;
    const refused = await fetchPage("https://x.org/a", answer(new Response(JSON.stringify({ error: "x.org turned the page reader away.", blocked: true }), { status: 424 }))).catch((e) => e);
    expect(refused).toBeInstanceOf(PageError);
    expect(refused.message).toBe("x.org turned the page reader away.");
    expect(refused.blocked).toBe(true);
    expect(refused.keepAsLink).toBe(true);

    const cloudflare = await fetchPage("https://x.org/a", answer(new Response("error code: 502", { status: 502 }))).catch((e) => e);
    expect(cloudflare.message).toBe("The page service failed (502). Try again in a moment.");
    expect(cloudflare.keepAsLink).toBe(true);

    const notPage = await fetchPage("https://x.org/a", answer(new Response(JSON.stringify({ error: "This link is not a web page." }), { status: 415 }))).catch((e) => e);
    expect(notPage.keepAsLink).toBe(false);
  });

  it("is kept as a link, titled from its address", () => {
    const d = linkDraft("https://press.princeton.edu/ideas/daniel-jackson-on-the-essence-of-software", "Turned away.");
    expect(d.title).toBe("Daniel jackson on the essence of software");
    expect(d.venue).toBe("press.princeton.edu");
    expect(d.url).toBe("https://press.princeton.edu/ideas/daniel-jackson-on-the-essence-of-software");
    expect(linkOnlyReason(d.url)).toBe("Turned away.");
    expect(linkOnlyReason(d.url)).toBeNull();
    expect(linkDraft("https://www.example.com/").title).toBe("example.com");
    expect(linkDraft("https://example.com/posts/1234").title).toBe("example.com");
  });
});
