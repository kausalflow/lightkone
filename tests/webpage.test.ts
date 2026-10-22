// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { fetchPage, isPageFile, pageFromFile, savedFrom, linkDraft, linkOnlyReason, markdownFile, pageDraft, PageError, pageMarkdown, paperIdentifier, personName, toMarkdown, isWebLink } from "../src/core/webpage";
import { bookmarklet } from "../src/core/capture";
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

describe("a page behind a browser check", () => {
  const blocked = () => new Response("<title>Just a moment...</title>", { status: 403, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } });
  const ask = (q: string, f: typeof fetch, env = {}) => handle(new Request("https://site/api/page?url=" + encodeURIComponent("https://press.example.edu/x") + q), f, env);

  it("is read through Jina Reader when the app asks, with the key when there is one", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = (async (u: string, init?: RequestInit) => {
      calls.push([u, init]);
      return u.startsWith("https://r.jina.ai/") ? new Response("<html><head><title>X</title></head><body>Text</body></html>") : blocked();
    }) as unknown as typeof fetch;
    const r = await ask("&reader=1", f, { JINA_API_KEY: "k" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ url: "https://press.example.edu/x", html: "<html><head><title>X</title></head><body>Text</body></html>", via: "r.jina.ai" });
    expect(calls[1][0]).toBe("https://r.jina.ai/https://press.example.edu/x");
    expect((calls[1][1]!.headers as Record<string, string>).authorization).toBe("Bearer k");
  });

  it("is not sent to Jina Reader unless asked, and says why when Jina fails too", async () => {
    let jina = 0;
    const f = (async (u: string) => (u.startsWith("https://r.jina.ai/") ? (jina++, new Response("<title>Just a moment...</title><body>", { status: 200 })) : blocked())) as unknown as typeof fetch;
    expect((await ask("", f)).status).toBe(424);
    expect(jina).toBe(0);
    const r = await ask("&reader=1", f);
    expect(r.status).toBe(424);
    expect(jina).toBe(1);
    expect((await r.json()).blocked).toBe(true);
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

describe("a page saved from the browser", () => {
  const MHTML = [
    "From: <Saved by Blink>",
    "Snapshot-Content-Location: https://press.example.edu/ideas/on-software",
    "Subject: On software",
    "MIME-Version: 1.0",
    'Content-Type: multipart/related;\r\n\ttype="text/html";\r\n\tboundary="----MultipartBoundary--abc----"',
    "",
    "",
    "------MultipartBoundary--abc----",
    "Content-Type: text/html",
    "Content-Transfer-Encoding: quoted-printable",
    "Content-Location: https://press.example.edu/ideas/on-software",
    "",
    '<html><head><meta charset=3D"utf-8"><title>On software</title></head><body><p>Caf=C3=A9 =\r\nconcepts.</p></body></html>',
    "------MultipartBoundary--abc----",
    "Content-Type: image/png",
    "Content-Transfer-Encoding: base64",
    "",
    "iVBORw0KGgo=",
    "------MultipartBoundary--abc------",
    "",
  ].join("\r\n");

  it("reads the page out of Chrome's MHTML file", async () => {
    const page = await pageFromFile(new File([MHTML], "On software.mhtml", { type: "multipart/related" }));
    expect(page.url).toBe("https://press.example.edu/ideas/on-software");
    expect(page.html).toContain("<p>Café concepts.</p>");
    expect(page.html).toContain('<meta charset="utf-8">');
  });

  it("finds where an HTML file came from, and says so when it can't", async () => {
    expect(savedFrom('<link rel="canonical" href="https://a.org/p">')).toBe("https://a.org/p");
    expect(savedFrom('<meta property="og:url" content="https://a.org/q">')).toBe("https://a.org/q");
    expect(savedFrom("<!-- saved from url=(0018)https://a.org/r/ -->\n<html></html>")).toBe("https://a.org/r/");
    const page = await pageFromFile(new File(['<html><head><link rel="canonical" href="https://a.org/p"></head><body>x</body></html>'], "p.html", { type: "text/html" }));
    expect(page.url).toBe("https://a.org/p");
    await expect(pageFromFile(new File(["<html><body>x</body></html>"], "p.html"))).rejects.toThrow(/which web page/);
  });

  it("knows a saved page file from a PDF", () => {
    expect(isPageFile(new File([""], "a.mhtml"))).toBe(true);
    expect(isPageFile(new File([""], "a", { type: "text/html" }))).toBe(true);
    expect(isPageFile(new File([""], "a.pdf", { type: "application/pdf" }))).toBe(false);
  });
});

describe("the bookmarklet on a page that isn't a paper", () => {
  it("posts the page to the app as a saved page file, naming where it came from", async () => {
    document.head.innerHTML = "<title>On software</title>";
    document.body.innerHTML = "<p>Concepts.</p>";
    const sent: HTMLFormElement[] = [];
    const submit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
      sent.push(this);
    };
    try {
      new Function(decodeURI(bookmarklet("https://lightkone.example/app/").slice("javascript:".length)))();
    } finally {
      HTMLFormElement.prototype.submit = submit;
    }
    expect(sent).toHaveLength(1);
    expect(sent[0].getAttribute("action")).toBe("https://lightkone.example/app/");
    expect(sent[0].method).toBe("post");
    expect(sent[0].target).toBe("_blank");
    const file = (sent[0].querySelector("input[type=file]") as HTMLInputElement).files![0];
    expect(file.name).toBe("On software.html");
    const html = await file.text();
    expect(savedFrom(html)).toBe(location.href);
    expect(html).toContain("<p>Concepts.</p>");
  });
});
