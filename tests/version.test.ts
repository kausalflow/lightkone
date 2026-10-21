import { describe, expect, it } from "vitest";
import { buildVersion } from "../scripts/version";

describe("build version", () => {
  it("names the package version, the commit date and the short hash", () => {
    const v = buildVersion();
    expect(v.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(v.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(v.label.startsWith(`${v.version} · ${v.date} · ${v.commit}`)).toBe(true);
  });
});
