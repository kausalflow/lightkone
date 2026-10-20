import { describe, expect, it } from "vitest";
import { byUse, suggest } from "../src/ChipPicker";

describe("folder and tag suggestions", () => {
  it("ranks what the library uses by how often", () => {
    expect(byUse([["timeseries", "ml"], ["ml"], ["physics", "ml"], ["physics"]])).toEqual(["ml", "physics", "timeseries"]);
  });
  it("suggests the most used first when nothing is typed, leaving out what is chosen", () => {
    expect(suggest(["ml", "physics", "timeseries"], ["ml"], "")).toEqual(["physics", "timeseries"]);
  });
  it("matches word starts before matches inside a name, case-insensitively", () => {
    const known = ["Physics/QFT", "time series", "Statistical Physics", "graphs"];
    expect(suggest(known, [], "phy")).toEqual(["Physics/QFT", "Statistical Physics"]);
    expect(suggest(known, [], "ser")).toEqual(["time series"]);
    expect(suggest(known, [], "aph")).toEqual(["graphs"]);
  });
});
