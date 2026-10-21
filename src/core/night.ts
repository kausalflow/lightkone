import type { Paper } from "./types";

// Hands the library to Dullaby, the calm night reader, inside the link that
// opens it. The list rides in the part of the address after #, which browsers
// never send to a server, and holds identifiers only: arXiv ids, else DOIs,
// newest first, "*" in front for starred and "_" for never opened. No titles,
// authors or notes. Dullaby keeps it on the device and finds papers near it.
//
//   https://dullaby.lab.leima.is/#lib=*2307.03172 _doi:10.1103/PhysRevD.1.1&from=<this app>

export const NIGHT_MAX = 3000;
export const DEFAULT_DULLABY = "https://dullaby.lab.leima.is/";

export const dullabyBase = (settings: Record<string, string>) => (settings["dullaby.url"] || DEFAULT_DULLABY).replace(/\/?$/, "/");

/** The library as Dullaby takes it: space-separated identifiers with flags. */
export function nightList(papers: Paper[], max = NIGHT_MAX): string {
  return papers
    .filter((p) => !p.trashed && (p.arxiv || p.doi))
    .sort((a, b) => (b.added ?? "").localeCompare(a.added ?? ""))
    .slice(0, max)
    .map((p) => `${p.starred ? "*" : ""}${p.opened ? "" : "_"}${p.arxiv ? p.arxiv.replace(/^arxiv:/i, "").replace(/v\d+$/, "") : `doi:${p.doi}`}`)
    .join(" ");
}

/**
 * The address that opens Dullaby with this library, and with one paper open
 * when `paper` is given. `app` is this app's own address, so Dullaby can send
 * papers you keep back here (?add=).
 */
export function nightLink(base: string, papers: Paper[], app: string, paper?: { arxiv: string; title: string }): string {
  const q = new URLSearchParams();
  if (paper) {
    q.set("arxiv", paper.arxiv);
    q.set("title", paper.title);
  }
  q.set("lib", nightList(papers));
  q.set("from", app);
  return `${base}#${q}`;
}

/** This app's address without query or fragment, for `from`. */
export const appAddress = (href: string) => {
  const u = new URL(href);
  u.search = "";
  u.hash = "";
  return u.toString();
};
