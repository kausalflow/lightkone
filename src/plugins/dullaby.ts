import type { LightkonePlugin } from "../core/types";

// Hands an arXiv paper to Dullaby, the calm night reader, which opens its full
// text in a dim, slow, scroll-to-sleep view.

const plugin: LightkonePlugin = {
  id: "dullaby",
  name: "Dullaby night reading",
  description: "Read an arXiv paper at night in Dullaby.",
  settings: [{ name: "url", label: "Dullaby address", placeholder: "https://dullaby.lab.leima.is/" }],
  actions: [
    {
      id: "read-at-night",
      label: "Read at night",
      available: (p) => Boolean(p.arxiv),
      async run(p, ctx) {
        const base = (ctx.settings["dullaby.url"] || "https://dullaby.lab.leima.is/").replace(/\/?$/, "/");
        const q = new URLSearchParams({ arxiv: p.arxiv!, title: p.title });
        ctx.open(`${base}#${q}`);
        return { kind: "none" };
      },
    },
  ],
};
export default plugin;
