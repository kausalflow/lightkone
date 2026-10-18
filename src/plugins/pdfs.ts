import type { LightkonePlugin } from "../core/types";

// Settings for getting PDFs; the work itself happens in the app
// (core/openpdf.ts, core/paperpile.ts) because it changes the library.

const plugin: LightkonePlugin = {
  id: "pdfs",
  name: "PDFs",
  description:
    "Free PDFs are downloaded into your storage when you add a paper: arXiv directly, other papers through Unpaywall's open-access copies.",
  settings: [
    { name: "auto", label: "Download open-access PDFs when adding papers", type: "checkbox" },
    { name: "email", label: "Contact email for Unpaywall", placeholder: "you@example.org", help: "Unpaywall asks for one. Without it, only arXiv PDFs are downloaded." },
    { name: "service", label: "PDF service URL (advanced)", placeholder: "api/pdf", help: "Leave empty when Lightkone runs on Cloudflare Pages." },
  ],
};
export default plugin;
