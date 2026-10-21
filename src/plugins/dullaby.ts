import type { LightkonePlugin } from "../core/types";
import { appAddress, dullabyBase, nightLink } from "../core/night";

// Hands an arXiv paper to Dullaby, the calm night reader, which opens its full
// text in a dim, slow, scroll-to-sleep view. The link also carries the
// library's identifiers (core/night.ts), so Dullaby finds new papers near it.

const plugin: LightkonePlugin = {
  id: "dullaby",
  name: "Dullaby night reading",
  description: "Read an arXiv paper at night in Dullaby, which also finds papers near your library.",
  settings: [{ name: "url", label: "Dullaby address", placeholder: "https://dullaby.lab.leima.is/" }],
  actions: [
    {
      id: "read-at-night",
      label: "Read at night",
      available: (p) => Boolean(p.arxiv),
      async run(p, ctx) {
        ctx.open(nightLink(dullabyBase(ctx.settings), ctx.library, appAddress(location.href), { arxiv: p.arxiv!, title: p.title }));
        return { kind: "none" };
      },
    },
  ],
};
export default plugin;
