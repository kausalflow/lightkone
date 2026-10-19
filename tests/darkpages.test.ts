import { describe, expect, it } from "vitest";
import { invertLightness } from "../src/reader/view";

describe("dark pages", () => {
  it("turns black text white and the white page black, keeping hues, and undoes itself", () => {
    const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 200, 30, 30, 255, 40, 90, 160, 128]);
    const before = px.slice();
    invertLightness(px);
    expect([...px.slice(0, 8)]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(px[4 * 2]).toBeGreaterThan(px[4 * 2 + 1]); // red stays red
    expect(px[15]).toBe(128); // alpha untouched
    invertLightness(px);
    expect([...px]).toEqual([...before]);
  });
});
