import { describe, expect, it } from "vitest";
import { appAddress, dullabyBase, nightLink, nightList } from "../src/core/night";
import type { Paper } from "../src/core/types";

const paper = (o: Partial<Paper>): Paper => ({ id: o.key ?? "x", key: "x", type: "article", title: "T", authors: ["Doe, J"], tags: [], added: "2026-01-01T00:00:00Z", fields: {}, ...o });

describe("handing the library to Dullaby", () => {
  const papers = [
    paper({ key: "old", arxiv: "1706.03762v5", added: "2020-01-01T00:00:00Z", opened: "2021-01-01T00:00:00Z" }),
    paper({ key: "new", arxiv: "arXiv:2307.03172", added: "2026-10-01T00:00:00Z", starred: true }),
    paper({ key: "doi", doi: "10.1103/PhysRevD.1.1", added: "2025-01-01T00:00:00Z", opened: "2025-02-01T00:00:00Z" }),
    paper({ key: "none", added: "2026-10-02T00:00:00Z" }),
    paper({ key: "gone", arxiv: "2101.00001", trashed: "2026-01-01T00:00:00Z" }),
  ];

  it("lists identifiers newest first, with starred and never-opened marks", () => {
    expect(nightList(papers)).toBe("*_2307.03172 doi:10.1103/PhysRevD.1.1 1706.03762");
  });

  it("carries no titles or authors", () => {
    const link = nightLink(dullabyBase({}), papers, "https://lk.example/app/");
    expect(link).not.toContain("Doe");
    expect(link.startsWith("https://dullaby.lab.leima.is/#lib=")).toBe(true);
  });

  it("opens one paper and says where to send kept papers", () => {
    const q = new URLSearchParams(nightLink("https://d.example/", papers, "https://lk.example/app/", { arxiv: "2307.03172", title: "Lost" }).split("#")[1]);
    expect(q.get("arxiv")).toBe("2307.03172");
    expect(q.get("title")).toBe("Lost");
    expect(q.get("lib")?.split(" ")).toHaveLength(3);
    expect(q.get("from")).toBe("https://lk.example/app/");
  });

  it("uses the Dullaby address from settings", () => {
    expect(dullabyBase({ "dullaby.url": "https://night.example" })).toBe("https://night.example/");
    expect(appAddress("https://lk.example/app/?open=1#x")).toBe("https://lk.example/app/");
  });

  it("stays a reasonable link for a large library", () => {
    const many = Array.from({ length: 1700 }, (_, i) => paper({ key: `k${i}`, arxiv: `2401.${String(i).padStart(5, "0")}` }));
    expect(nightLink(dullabyBase({}), many, "https://lk.example/app/").length).toBeLessThan(40_000);
  });
});
