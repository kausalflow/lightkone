import type { LightkonePlugin } from "../core/types";

// Settings for keeping folder .bib files in GitHub (see core/bibsync.ts). The
// targets themselves live in the library, so every device syncs the same files.

const plugin: LightkonePlugin = {
  id: "bibsync",
  name: "BibTeX sync to GitHub",
  description:
    "Keep a .bib of a folder in a GitHub repository, for Overleaf or a paper's own repository. Turn it on from a folder's list (Sync .bib).",
  settings: [
    {
      name: "token",
      label: "GitHub token",
      type: "password",
      help: "A fine-grained token with Contents read and write on the repositories you sync to. Left empty, the GitHub storage token is used.",
    },
  ],
};
export default plugin;
