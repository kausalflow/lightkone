import { plainMath, type MathRenderer } from "./markdown";
import { useEffect, useState } from "preact/hooks";

// KaTeX is loaded the first time an answer with math is shown.
let katexMath: Promise<MathRenderer> | null = null;
function loadMath(): Promise<MathRenderer> {
  katexMath ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([k]) => (tex: string, display: boolean) =>
    k.default.renderToString(tex, { displayMode: display, throwOnError: false, output: "htmlAndMathml" }),
  );
  return katexMath;
}

/** The math renderer to use now: plain until KaTeX has loaded. */
export function useMath(): MathRenderer {
  const [math, setMath] = useState<MathRenderer>(() => plainMath);
  useEffect(() => {
    loadMath().then((m) => setMath(() => m), () => {});
  }, []);
  return math;
}
