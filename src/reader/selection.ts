// Keeps text selection in a pdf.js text layer from jumping. The text layer is
// loose pieces of positioned text with gaps between them; when a finger or
// the mouse is over a gap, the browser picks some far piece of text, and the
// selection suddenly runs down the page. pdf.js's own viewer avoids this with
// an "endOfContent" block that fills the gaps while selecting and is moved
// next to the end of the selection; this is that, from pdfjs-dist's
// TextLayerBuilder, for the bare TextLayer used here.

const layers = new Map<HTMLElement, HTMLElement>();
let listening: AbortController | null = null;

const reset = (end: HTMLElement, layer: HTMLElement) => {
  layer.append(end);
  end.style.width = "";
  end.style.height = "";
  layer.classList.remove("selecting");
};

/** Add the gap filler to a rendered text layer. */
export function guardSelection(layer: HTMLElement) {
  const end = document.createElement("div");
  end.className = "endOfContent";
  layer.append(end);
  layer.addEventListener("pointerdown", () => layer.classList.add("selecting"));
  layers.set(layer, end);
  listen();
}

/** Forget a text layer that is being removed. */
export function unguardSelection(layer: HTMLElement) {
  layers.delete(layer);
  if (!layers.size) {
    listening?.abort();
    listening = null;
  }
}

// Firefox and Chromium 148 or later keep the selection steady by themselves,
// as pdf.js found; there the filler only needs to fill the gaps.
let native: boolean | undefined;
function handlesGapsItself(): boolean {
  if (native === undefined) {
    const chromium = /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1];
    native = /Firefox\//.test(navigator.userAgent) || (!!chromium && parseInt(chromium, 10) >= 148);
  }
  return native;
}

function listen() {
  if (listening) return;
  listening = new AbortController();
  const { signal } = listening;
  let pointerDown = false;
  const resetAll = () => layers.forEach(reset);
  document.addEventListener("pointerdown", () => (pointerDown = true), { signal });
  document.addEventListener("pointerup", () => ((pointerDown = false), resetAll()), { signal });
  addEventListener("blur", () => ((pointerDown = false), resetAll()), { signal });
  document.addEventListener("keyup", () => !pointerDown && resetAll(), { signal });

  let prev: Range | null = null;
  document.addEventListener(
    "selectionchange",
    () => {
      const sel = document.getSelection();
      if (!sel || !sel.rangeCount) return resetAll();
      const range = sel.getRangeAt(0);
      for (const [layer, end] of layers) {
        if (range.intersectsNode(layer)) layer.classList.add("selecting");
        else reset(end, layer);
      }
      if (handlesGapsItself()) return;
      // Move the filler next to the moving end of the selection, so the gaps
      // around the finger belong to the text being selected.
      const movingStart = prev && (range.compareBoundaryPoints(Range.END_TO_END, prev) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prev) === 0);
      let anchor: Node | null = movingStart ? range.startContainer : range.endContainer;
      if (anchor?.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
      if (!movingStart && range.endOffset === 0 && anchor) {
        do {
          while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
          anchor = anchor?.previousSibling ?? null;
        } while (anchor && !anchor.childNodes.length);
      }
      const el = anchor as HTMLElement | null;
      const layer = el?.parentElement?.closest<HTMLElement>(".textLayer");
      const end = layer && layers.get(layer);
      if (el?.parentElement && layer && end) {
        end.style.width = layer.style.width;
        end.style.height = layer.style.height;
        end.style.userSelect = "text";
        el.parentElement.insertBefore(end, movingStart ? el : el.nextSibling);
      }
      prev = range.cloneRange();
    },
    { signal },
  );
}
