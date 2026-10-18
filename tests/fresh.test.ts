import { describe, expect, it } from "vitest";
import { handle, parseFeed } from "../functions/api/arxiv";
import { digest, dismiss, emptyFresh, profileIds, rank, toDraft, topCategories, type Preprint } from "../src/core/fresh";
import type { Paper } from "../src/core/types";

const paper = (id: string, p: Partial<Paper> = {}): Paper => ({ id, key: id, type: "article", title: `Paper ${id}`, authors: [], tags: [], added: "2026-01-01", fields: {}, ...p });
const pre = (arxiv: string, title: string, abstract: string, published = "2026-10-17T17:00:00Z", categories = ["astro-ph.CO"]): Preprint => ({ arxiv, title, abstract, authors: ["Peebles, Jim"], published, categories });

const FEED = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>http://arxiv.org/abs/2610.17896v2</id><published>2026-10-17T17:59:00Z</published>
<title>Dark energy &amp; the
  $H_0$ tension</title><summary>  We revisit
 the tension.</summary>
<author><name>Adam G. Riess</name></author><author><name>Planck</name></author>
<arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="astro-ph.CO"/>
<category term="astro-ph.CO"/><category term="gr-qc"/></entry></feed>`;

describe("arXiv pass-through", () => {
  it("reads an Atom feed", () => {
    expect(parseFeed(FEED)).toEqual([
      { arxiv: "2610.17896", title: "Dark energy & the $H_0$ tension", abstract: "We revisit the tension.", authors: ["Riess, Adam G.", "Planck"], published: "2026-10-17T17:59:00Z", categories: ["astro-ph.CO", "gr-qc"] },
    ]);
  });

  it("asks arXiv for the newest in some categories, or for some ids, and nothing else", async () => {
    const asked: string[] = [];
    const f = (async (url: string) => {
      asked.push(String(url));
      return new Response(FEED);
    }) as typeof fetch;
    const r = await handle(new Request("https://x/api/arxiv?cats=astro-ph.CO,hep-th"), f);
    expect(r.headers.get("cache-control")).toBe("public, max-age=3600");
    expect((await r.json())[0].arxiv).toBe("2610.17896");
    await handle(new Request("https://x/api/arxiv?ids=1706.03762v5"), f);
    expect(asked).toEqual([
      "https://export.arxiv.org/api/query?search_query=cat:astro-ph.CO+OR+cat:hep-th&sortBy=submittedDate&sortOrder=descending&max_results=400",
      "https://export.arxiv.org/api/query?id_list=1706.03762&max_results=1",
    ]);
    expect((await handle(new Request("https://x/api/arxiv?cats=a)b"), f)).status).toBe(400);
    expect((await handle(new Request("https://x/api/arxiv"), f)).status).toBe(400);
    expect(asked).toHaveLength(2);
  });
});

describe("new on arXiv for you", () => {
  const library = [
    paper("lcdm", { title: "Cosmological constraints on dark energy from supernovae", abstract: "Type Ia supernovae constrain the dark energy equation of state and the Hubble constant." }),
    paper("bao", { title: "Baryon acoustic oscillations in galaxy surveys", abstract: "The acoustic scale measured in galaxy clustering constrains the expansion history." }),
    paper("have", { title: "Already here", arxiv: "arXiv:2610.00003v1" }),
  ];
  const today = [
    pre("2610.00001", "Dark energy equation of state from supernovae and BAO", "We combine supernovae with baryon acoustic oscillations to constrain dark energy."),
    pre("2610.00002", "Protein folding with diffusion models", "A generative model for protein structures."),
    pre("2610.00003", "Already here", "Old news."),
    pre("2610.00004", "Gravitational lensing of galaxy clusters", "Weak lensing masses of clusters.", "2026-10-16T10:00:00Z"),
  ];

  it("puts what is close to the library first, and says what it is near", () => {
    const picks = rank(today, library, emptyFresh());
    expect(picks.map((p) => p.preprint.arxiv)).toEqual(["2610.00001", "2610.00004", "2610.00002"]);
    expect(picks[0].near[0]).toBe("lcdm");
    expect(picks[0].near).toContain("bao");
    expect(picks[2].near).toEqual([]);
  });

  it("lifts keywords and learns from what was turned down", () => {
    const lifted = rank(today, library, { ...emptyFresh(), keywords: ["Protein"] });
    expect(lifted.map((p) => p.preprint.arxiv)).toEqual(["2610.00001", "2610.00002", "2610.00004"]);
    expect(lifted[1].keywords).toEqual(["protein"]);

    const s = dismiss(emptyFresh(), pre("2609.99999", "Supernovae dark energy constraints revisited", "Supernovae and dark energy, again."));
    const picks = rank(today, library, dismiss(s, today[1]));
    expect(picks.map((p) => p.preprint.arxiv)).not.toContain("2610.00002");
    const before = rank(today, library, emptyFresh())[0];
    expect(picks[0].preprint.arxiv).toBe("2610.00001");
    expect(picks[0].score).toBeLessThan(before.score - 0.1);
  });

  it("marks what appeared since the last visit, and groups the best by day", () => {
    const picks = rank(today, library, { ...emptyFresh(), visited: "2026-10-17T00:00:00Z" });
    expect(picks.filter((p) => p.fresh).map((p) => p.preprint.arxiv)).toEqual(["2610.00001", "2610.00002"]);
    const days = digest(picks, { now: new Date("2026-10-18T08:00:00Z"), max: 2 });
    expect(days.map((d) => [d.day, d.picks.map((p) => p.preprint.arxiv)])).toEqual([
      ["2026-10-17", ["2610.00001"]],
      ["2026-10-16", ["2610.00004"]],
    ]);
    expect(digest(picks, { now: new Date("2026-12-18T08:00:00Z") })).toEqual([]);
  });

  it("guesses categories from the library's newest arXiv papers", () => {
    expect(profileIds([paper("x", { arxiv: "arXiv:1706.03762v5", added: "2026-02-01" }), paper("y", { arxiv: "2101.00001", added: "2026-03-01" }), paper("z")])).toEqual(["2101.00001", "1706.03762"]);
    expect(topCategories([today[0], today[1], pre("1", "", "", "", ["hep-th"]), pre("2", "", "", "", ["hep-th", "astro-ph.CO"]), pre("3", "", "", "", ["hep-th"])], 2)).toEqual(["hep-th", "astro-ph.CO"]);
  });

  it("adds a preprint as a library entry", () => {
    expect(toDraft(today[0])).toMatchObject({ title: today[0].title, arxiv: "2610.00001", year: 2026, url: "https://arxiv.org/abs/2610.00001", fields: { eprinttype: "arxiv", eprint: "2610.00001", primaryclass: "astro-ph.CO" } });
  });
});
