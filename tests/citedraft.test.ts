import { describe, expect, it } from "vitest";
import { applyCites, claimScore, parseTriage, plainOf, queryFor, sentencesOf, uncitedClaims } from "../src/core/citedraft";

const DRAFT = String.raw`\documentclass{revtex4-2}
\usepackage{amsmath}
\title{A note. With a full stop}
\begin{document}
\maketitle
\begin{abstract}
It has been shown that nothing here needs citing.
\end{abstract}
\section{Introduction}
The cosmic microwave background has been measured to a precision of $10^{-5}$ by several experiments. % Planck?
Inflation was proposed to solve the horizon problem~\cite{Guth1981}.
In this paper we show that the bound improves by a factor of two.

Recent observations of type Ia supernovae indicate that the expansion of the Universe is accelerating, e.g.\ at $z \sim 0.5$, see Fig.~\ref{fig:sn}.
The energy density is
\begin{equation}
  \rho = \frac{3H^2}{8\pi G} .
\end{equation}
where $H$ is the Hubble rate.
\begin{figure}
\caption{Supernovae. The data are shown.}
\end{figure}
Neutrino oscillation experiments have established that at least two neutrinos are massive (Super-Kamiokande, 1998).
\bibliography{refs}
\end{document}
`;

describe("Cite my draft", () => {
  const all = sentencesOf(DRAFT);

  it("reads sentences from the body only, past the preamble, abstract, headings and floats", () => {
    const plains = all.map((s) => s.plain);
    expect(plains.some((p) => p.includes("nothing here needs citing"))).toBe(false);
    expect(plains.some((p) => p.includes("Introduction"))).toBe(false);
    expect(plains.some((p) => p.includes("Supernovae"))).toBe(false);
    expect(plains.some((p) => p.startsWith("A note"))).toBe(false);
    expect(plains[0]).toBe("The cosmic microwave background has been measured to a precision of by several experiments.");
  });

  it("does not end a sentence at an abbreviation, a comment or inside display math", () => {
    const sn = all.find((s) => s.plain.startsWith("Recent observations"))!;
    expect(sn.plain).toContain("see Fig.");
    const rho = all.find((s) => s.plain.startsWith("The energy density"))!;
    expect(rho.plain).toBe("The energy density is where is the Hubble rate.");
    expect(rho.line).toBe(15);
  });

  it("knows which sentences cite and which announce the paper's own work", () => {
    const inflation = all.find((s) => s.plain.startsWith("Inflation"))!;
    expect(inflation.cited).toBe(true);
    const own = all.find((s) => s.plain.startsWith("In this paper"))!;
    expect(own.score).toBe(0);
    const claims = uncitedClaims(all).map((s) => s.plain.split(" ")[0]);
    expect(claims).toEqual(["The", "Recent", "Neutrino"]);
  });

  it("puts \\cite before the full stop and leaves the rest of the source as it was", () => {
    const cmb = all[0];
    const nu = all.find((s) => s.plain.startsWith("Neutrino"))!;
    const out = applyCites(DRAFT, all, new Map([[cmb.n, ["Planck2018"]], [nu.n, ["Fukuda1998", "Ahmad2002"]]]), "citep");
    expect(out).toContain("by several experiments~\\citep{Planck2018}. % Planck?");
    expect(out).toContain("(Super-Kamiokande, 1998)~\\citep{Fukuda1998,Ahmad2002}.");
    const back = out.replace("~\\citep{Planck2018}", "").replace("~\\citep{Fukuda1998,Ahmad2002}", "");
    expect(back).toBe(DRAFT);
  });

  it("works on a pasted paragraph with no preamble", () => {
    const s = sentencesOf("Dark matter makes up about 27\\% of the energy budget. We then fit the model.");
    expect(s.map((x) => x.plain)).toEqual(["Dark matter makes up about 27% of the energy budget.", "We then fit the model."]);
    expect(s[0].score).toBeGreaterThan(0);
    expect(s[1].score).toBe(0);
  });

  it("makes plain text and a short search from LaTeX", () => {
    expect(plainOf(String.raw`The \emph{renormalization group} flow~\cite{Wilson1971} has a fixed point $T_c$.`)).toBe("The renormalization group flow has a fixed point.");
    expect(queryFor("The renormalization group flow has a fixed point at the critical temperature")).toBe("renormalization group flow fixed point critical temperature");
    expect(claimScore("Short one.").score).toBe(0);
  });

  it("reads Claude's triage", () => {
    expect(parseTriage('Here: [{"n": 3, "needs": true, "query": "supernova acceleration", "why": "an observation"}, {"n": 4, "needs": false}, {"x": 1}]')).toEqual([
      { n: 3, needs: true, query: "supernova acceleration", why: "an observation" },
      { n: 4, needs: false, query: undefined, why: undefined },
    ]);
    expect(parseTriage("no json")).toEqual([]);
  });
});
