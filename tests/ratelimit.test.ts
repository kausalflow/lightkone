import { describe, expect, it } from "vitest";
import { fromAnotherSite, guard, wait } from "../functions/api/_middleware";

const req = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://lightkone.lab.kausalflow.com${path}`, { headers: { "cf-connecting-ip": "1.2.3.4", ...headers } });
const ok = async () => new Response("ok");

describe("the /api guard", () => {
  it("lets this site's own app in, and turns other websites away", () => {
    expect(fromAnotherSite(req("/api/pdf", { "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(fromAnotherSite(req("/api/pdf"))).toBe(false);
    expect(fromAnotherSite(req("/api/pdf", { origin: "https://lightkone.lab.kausalflow.com" }))).toBe(false);
    expect(fromAnotherSite(req("/api/pdf", { "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(fromAnotherSite(req("/api/pdf", { origin: "https://example.org" }))).toBe(true);
  });

  it("counts calls a minute per address and service", () => {
    const calls = new Map<string, number[]>();
    for (let i = 0; i < 3; i++) expect(wait("pdf a", 3, 1000, calls)).toBe(0);
    expect(wait("pdf a", 3, 2000, calls)).toBe(59);
    expect(wait("pdf b", 3, 2000, calls)).toBe(0);
    expect(wait("pdf a", 3, 61_001, calls)).toBe(0);
  });

  it("answers 429 with Retry-After when over the limit", async () => {
    const calls = new Map<string, number[]>();
    for (let i = 0; i < 30; i++) expect((await guard(req("/api/pdf?doi=x"), ok, calls)).status).toBe(200);
    const r = await guard(req("/api/pdf?doi=x"), ok, calls);
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await guard(req("/api/tex?arxiv=1"), ok, calls)).status).toBe(200);
    expect((await guard(req("/api/pdf", { "sec-fetch-site": "cross-site" }), ok, calls)).status).toBe(403);
  });
});
