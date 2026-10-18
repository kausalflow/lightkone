# Writing a plugin

A plugin is an ES module whose default export is a `LightkonePlugin` (or a
function returning one). Add its URL under Settings → Plugins. The types live in
[`src/core/types.ts`](../src/core/types.ts).

```js
// my-plugin.js
export default {
  id: "inspire",
  name: "INSPIRE-HEP",
  description: "Adds papers by INSPIRE record id.",
  lookups: [
    {
      id: "inspire",
      label: "INSPIRE record",
      matches: (s) => /inspirehep\.net\/literature\/\d+/.test(s),
      async resolve(s) {
        const id = s.match(/literature\/(\d+)/)[1];
        const r = await fetch(`https://inspirehep.net/api/literature/${id}`);
        const m = (await r.json()).metadata;
        return {
          title: m.titles[0].title,
          authors: m.authors.map((a) => a.full_name),
          year: Number(m.preprint_date?.slice(0, 4)) || undefined,
          arxiv: m.arxiv_eprints?.[0]?.value,
          doi: m.dois?.[0]?.value,
          fields: {},
        };
      },
    },
  ],
  actions: [
    {
      id: "inspire-citations",
      label: "Citations on INSPIRE",
      available: (p) => Boolean(p.arxiv),
      async run(p, ctx) {
        ctx.open(`https://inspirehep.net/search?p=refersto:arxiv:${p.arxiv}`);
        return { kind: "none" };
      },
    },
  ],
};
```

## What a plugin can provide

| Field | Purpose |
| --- | --- |
| `storage` | Places a library can live. `create(config)` returns a `StorageAdapter` with `read`, `write`, `list` and optionally `remove` and `seed` (papers the backend already holds in another format). |
| `lookups` | Turn an identifier or link into a paper. The first lookup whose `matches` returns true is used. |
| `importers` | Turn pasted text or a file into papers. |
| `actions` | Buttons on a paper. `run` returns text to show, a list of papers the user can add, or nothing. |
| `settings` | Fields shown in Settings, read back as `ctx.settings["<plugin id>.<field>"]`. |

Plugins run in the page with full access, so only load code you trust, and
serve plugin files with CORS headers that allow the Lightkone origin.
