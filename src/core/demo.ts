import type { Paper, PaperDraft } from "./types";

// A paper to try things on in a brand-new library, so the reader, highlights
// and Ask have something to work with before one's own papers are in.

export const DEMO_TAG = "Example";
export const DEMO_ARXIV = "2302.07730";

export const demoDraft = (): PaperDraft => ({
  type: "article",
  title: "Transformer models: an introduction and catalog",
  authors: ["Amatriain, Xavier", "Sankar, Ananth", "Bing, Jie", "Bodigutla, Praveen Kumar", "Hazen, Timothy J.", "Kazi, Michaeel"],
  year: 2023,
  venue: "arXiv",
  arxiv: DEMO_ARXIV,
  url: `https://arxiv.org/abs/${DEMO_ARXIV}`,
  abstract:
    "In the past few years we have seen the meteoric appearance of dozens of foundation models of the Transformer family, all of which have memorable and sometimes funny, but not self-explanatory, names. The goal of this paper is to offer a somewhat comprehensive but simple catalog and classification of the most popular Transformer models. The paper also includes an introduction to the most important aspects and innovations in Transformer models. Our catalog will include models that are trained using self-supervised learning (e.g., BERT or GPT3) as well as those that are further trained using a human-in-the-loop (e.g. the InstructGPT model used by ChatGPT).",
  tags: [DEMO_TAG],
  fields: {},
});

export const isDemo = (p: Pick<Paper, "arxiv" | "tags">) => p.arxiv === DEMO_ARXIV && p.tags.includes(DEMO_TAG);

/** Remembered per browser, so the example comes once and stays gone once removed. */
const DEMO_KEY = "lightkone.demo";
const WELCOME_KEY = "lightkone.welcomed";
const get = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return "1";
  }
};
const set = (k: string) => {
  try {
    localStorage.setItem(k, "1");
  } catch {
    /* private window: shown again next time, which is harmless */
  }
};
export const demoOffered = () => Boolean(get(DEMO_KEY));
export const markDemoOffered = () => set(DEMO_KEY);
export const welcomed = () => Boolean(get(WELCOME_KEY));
export const markWelcomed = () => set(WELCOME_KEY);

/**
 * The example goes only into a library that is brand new, in this browser's own
 * storage: never into a bucket, a GitHub repository or a shared library, and
 * never next to papers that came from a .bib or a link.
 */
export function wantsDemo(o: { provider: string; shared: boolean; loaded: number; papers: number; arriving: boolean }): boolean {
  return o.provider === "browser" && !o.shared && !o.loaded && !o.papers && !o.arriving && !demoOffered();
}
