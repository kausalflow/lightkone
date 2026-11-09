import type { LightkonePlugin } from "../core/types";

// Settings for paper health; the checking happens in the app (core/health.ts)
// because it changes the library.

const plugin: LightkonePlugin = {
  id: "health",
  name: "Paper health",
  description:
    "Retractions, corrections, expressions of concern and arXiv withdrawals, from Crossref (publishers and the Retraction Watch database) and arXiv. Each paper shows a badge when something is found.",
  settings: [
    {
      name: "auto",
      label: "Check papers for retractions and corrections once a month",
      type: "checkbox",
      help: "Sends the papers' DOIs to Crossref and arXiv ids to arXiv, a few dozen at a time, a little after the library opens.",
    },
  ],
};
export default plugin;
