import { describe, expect, it } from "vitest";
import { crc32, keptPart, KEEP_MARKER, noteName, obsidianNote, openLink, zip } from "../src/core/obsidian";
import type { Paper } from "../src/core/types";

const paper: Paper = {
  id: "p1", key: "Jumper2021", type: "article", title: "Highly accurate protein structure prediction with AlphaFold",
  authors: ["Jumper, John", "Evans, Richard"], year: 2021, venue: "Nature", doi: "10.1038/s41586-021-03819-2",
  tags: ["protein folding", "ML"], added: "2026-01-01", fields: {}, notes: "Read section 1.9 again.",
};
const app = "https://lightkone.lab.kausalflow.com/";
const hl = [{ id: "h", page: 3, rects: [], text: "self-distillation\nwith Uniclust30", note: "Key trick.", created: "2026-01-01" }];

describe("obsidian export", () => {
  it("writes properties, notes and highlights that link back", () => {
    const md = obsidianNote(paper, hl, app);
    expect(md.startsWith('---\ntitle: "Highly accurate protein structure prediction with AlphaFold"\nauthors:\n  - "Jumper, John"\n  - "Evans, Richard"\nyear: 2021\n')).toBe(true);
    expect(md).toContain('citekey: "Jumper2021"');
    expect(md).toContain("tags:\n  - paper\n  - protein-folding\n  - ML\n---");
    expect(md).toContain("## Notes\n\nRead section 1.9 again.");
    expect(md).toContain(`> [!quote] [p. 3](${app}?open=p1&page=3)\n> self-distillation\n> with Uniclust30\n\nKey trick.`);
    expect(noteName(paper)).toBe("@Jumper2021.md");
    expect(openLink("https://x.y/app/?add=1#z", paper)).toBe("https://x.y/app/?open=p1");
  });

  it("keeps what was written below the marker, without growing", () => {
    const first = obsidianNote(paper, hl, app);
    const edited = `${first}My own thoughts.\n`;
    const second = obsidianNote({ ...paper, notes: "Changed." }, hl, app, keptPart(edited));
    expect(second).toContain("Changed.");
    expect(second.endsWith(`${KEEP_MARKER}\n\nMy own thoughts.\n`)).toBe(true);
    expect(obsidianNote(paper, hl, app, keptPart(second))).toBe(obsidianNote(paper, hl, app, keptPart(obsidianNote(paper, hl, app, keptPart(second)))));
    expect(keptPart("no marker")).toBe("");
  });

  it("makes a zip that unpacks", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const z = zip([{ name: "@a.md", text: "héllo" }, { name: "@b.md", text: "world" }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = z.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
    const nameLen = v.getUint16(26, true);
    const size = v.getUint32(18, true);
    expect(new TextDecoder().decode(z.slice(30, 30 + nameLen))).toBe("@a.md");
    expect(new TextDecoder().decode(z.slice(30 + nameLen, 30 + nameLen + size))).toBe("héllo");
  });
});
