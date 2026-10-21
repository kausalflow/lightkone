// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { dockSize } from "../src/PanelFrame";

describe("dockSize", () => {
  beforeEach(() => localStorage.clear());

  it("starts at a readable width and height", () => {
    expect(dockSize("right")).toBe(440);
    expect(dockSize("bottom")).toBe(320);
  });

  it("remembers where each edge was dragged to", () => {
    localStorage.setItem("lightkone.dock.size", JSON.stringify({ right: 560 }));
    expect(dockSize("right")).toBe(560);
    expect(dockSize("bottom")).toBe(320);
  });

  it("ignores a size too small to use, or a damaged setting", () => {
    localStorage.setItem("lightkone.dock.size", JSON.stringify({ right: 40 }));
    expect(dockSize("right")).toBe(440);
    localStorage.setItem("lightkone.dock.size", "{");
    expect(dockSize("right")).toBe(440);
  });
});
