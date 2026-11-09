import { describe, expect, it } from "vitest";
import { locate, spans, squeeze, type TextBit } from "../src/core/locate";
import { citedNumbers, withoutSources } from "../src/core/wholepdf";

const line = (page: number, y: number, str: string, x = 0.1, w = 0.8): TextBit => ({ page, str, x, y, w, h: 0.02 });

describe("squeeze", () => {
  it("keeps letters and digits, opens ligatures, lowercases", () => {
    expect(squeeze("The ﬁeld  Φ(x) = 0.12 eV")).toBe("thefieldφx012ev");
  });
});

describe("spans", () => {
  it("finds a quote word for word, or piece by piece", () => {
    expect(spans("abcdefgh", "cde")).toEqual([[2, 5]]);
    const before = "thebeginningofthequotegoeson";
    const after = "andtheendofthequoteisherenow";
    // Math read a little differently: marked over.
    const s = spans("x".repeat(20) + before + "mathgarble" + after + "y".repeat(20), before + "math" + after);
    expect(s).toEqual([[20, 20 + before.length + 10 + after.length]]);
    // A long caption between the parts: left out.
    const caption = "figuretwoshowsthemodelarchitectureinfullwithallitslayersandconnections";
    const t = spans(before + caption + after, before + after);
    expect(t.length).toBe(2);
    expect(t[0][1]).toBeLessThanOrEqual(before.length);
    expect(t[1][0]).toBeGreaterThanOrEqual(before.length + caption.length);
    expect(spans("nothing alike here at all", "a quote that is not there anywhere")).toEqual([]);
  });
});

describe("locate", () => {
  const bits = [
    line(3, 0.1, "We assume the metric is static and"),
    line(3, 0.13, "spherically sym-"),
    line(3, 0.16, "metric, so that g_tt = −(1 − 2M/r)."),
    line(4, 0.1, "On the next page the result con-"),
    line(4, 0.13, "tinues here."),
  ];
  it("marks the part of each line the quote covers, joined across a hyphen", () => {
    const f = locate(bits, "the metric is static and spherically symmetric")!;
    expect(f).toHaveLength(1);
    expect(f[0].page).toBe(3);
    expect(f[0].rects).toHaveLength(3);
    // The first line from "the metric", not from its start.
    expect(f[0].rects[0][0]).toBeGreaterThan(0.1);
    // The last line only up to "metric".
    expect(f[0].rects[2][2]).toBeLessThan(0.8 * 0.3);
  });
  it("follows a quote onto the next page", () => {
    const f = locate(bits, "the result continues here")!;
    expect(f.map((x) => x.page)).toEqual([4]);
    const g = locate(bits, "g_tt = −(1 − 2M/r). On the next page")!;
    expect(g.map((x) => x.page)).toEqual([3, 4]);
  });
  it("gives null when the words are not there", () => {
    expect(locate(bits, "a sentence from another paper entirely")).toBeNull();
  });
});

describe("citation numbers", () => {
  it("lists the numbers an answer cites, each once", () => {
    expect(citedNumbers("A [2]. B [1, 3]; C [2]")).toEqual([2, 1, 3]);
  });
  it("takes out only the numbers added for this paper's passages", () => {
    expect(withoutSources("A [1]. B [2, 3]. C [4].", new Set([1, 3]))).toBe("A. B [2]. C [4].");
  });
});

describe("locate over a page break", () => {
  it("leaves out the page number between the two parts", () => {
    const bits = [line(3, 0.85, "the output is computed as a weighted sum"), line(3, 0.95, "3", 0.49, 0.01), line(4, 0.1, "of the values.")];
    const f = locate(bits, "the output is computed as a weighted sum of the values")!;
    expect(f.flatMap((x) => x.rects).some((r) => r[1] > 0.9)).toBe(false);
  });
});
