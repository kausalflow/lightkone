import { zip, type ZipEntry } from "./zip";

// Writes an EPUB 3 file (with an EPUB 2 table of contents too, which older and
// smaller readers use). Chapters arrive as XHTML fragments that are already
// clean (core/ereader.ts makes them); this only packs them.

export interface BookChapter {
  title: string;
  /** XHTML body content, already escaped and well formed. */
  body: string;
}

export interface BookImage {
  /** File name inside the book's images folder, e.g. "m12.png". */
  name: string;
  data: Uint8Array;
  type: "image/png" | "image/jpeg";
}

export interface Book {
  /** A stable identifier, e.g. "urn:lightkone:<paper id>". */
  id: string;
  title: string;
  authors: string[];
  language?: string;
  description?: string;
  /** When the book was made, as an ISO time. */
  modified?: string;
  chapters: BookChapter[];
  images: BookImage[];
}

export const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

// Plain, small styles: e-ink readers apply their own fonts and margins, so
// this only says what matters for papers.
export const BOOK_CSS = `body { margin: 0; line-height: 1.4; }
h1 { font-size: 1.3em; margin: 0 0 0.6em; }
h2 { font-size: 1.15em; margin: 1em 0 0.5em; }
h3, h4 { font-size: 1em; margin: 0.9em 0 0.4em; }
p { margin: 0 0 0.6em; }
.authors { font-style: italic; }
.meta { font-size: 0.85em; }
.abstract { margin: 0.8em 0; }
.eq { text-align: center; margin: 0.5em 0; }
.eq .tag { font-size: 0.85em; }
img.m { vertical-align: middle; }
img.d { max-width: 100%; }
.fig { text-align: center; margin: 0.8em 0; }
.fig img { max-width: 100%; }
.caption { font-size: 0.85em; text-align: left; }
.note { font-size: 0.85em; }
table { border-collapse: collapse; font-size: 0.85em; }
td, th { padding: 0 0.3em; }
.bib li { font-size: 0.85em; margin-bottom: 0.3em; }
`;

function page(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>
`;
}

/** The EPUB file for a book. */
export async function makeEpub(b: Book): Promise<Uint8Array> {
  const lang = b.language ?? "en";
  const modified = (b.modified ?? new Date().toISOString()).replace(/\.\d+Z$/, "Z");
  const chapters = b.chapters.length ? b.chapters : [{ title: b.title, body: `<h1>${xml(b.title)}</h1>` }];
  const files = chapters.map((c, i) => ({ ...c, file: `c${String(i + 1).padStart(3, "0")}.xhtml`, id: `c${i + 1}` }));

  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="style.css" media-type="text/css"/>`,
    ...files.map((f) => `<item id="${f.id}" href="${f.file}" media-type="application/xhtml+xml"/>`),
    ...b.images.map((im, i) => `<item id="i${i + 1}" href="images/${xml(im.name)}" media-type="${im.type}"/>`),
  ];
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${xml(b.id)}</dc:identifier>
<dc:title>${xml(b.title)}</dc:title>
${b.authors.map((a) => `<dc:creator>${xml(a)}</dc:creator>`).join("\n")}
<dc:language>${lang}</dc:language>
${b.description ? `<dc:description>${xml(b.description)}</dc:description>` : ""}
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${files.map((f) => `<itemref idref="${f.id}"/>`).join("\n")}
</spine>
</package>
`;
  const nav = page(
    "Contents",
    `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${files.map((f) => `<li><a href="${f.file}">${xml(f.title)}</a></li>`).join("\n")}
</ol></nav>`,
  );
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${xml(b.id)}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head>
<docTitle><text>${xml(b.title)}</text></docTitle>
<navMap>
${files.map((f, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${xml(f.title)}</text></navLabel><content src="${f.file}"/></navPoint>`).join("\n")}
</navMap>
</ncx>
`;
  const entries: ZipEntry[] = [
    { name: "mimetype", data: "application/epub+zip", store: true },
    {
      name: "META-INF/container.xml",
      data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>
`,
    },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/nav.xhtml", data: nav },
    { name: "OEBPS/toc.ncx", data: ncx },
    { name: "OEBPS/style.css", data: BOOK_CSS },
    ...files.map((f) => ({ name: `OEBPS/${f.file}`, data: page(f.title, f.body) })),
    ...b.images.map((im) => ({ name: `OEBPS/images/${im.name}`, data: im.data, store: true })),
  ];
  return zip(entries);
}
