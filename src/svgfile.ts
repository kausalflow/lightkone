// Save a drawn map as a standalone .svg picture: the styles the page gives
// it through CSS (and its theme's colours) are written onto each element, so
// the file looks the same opened anywhere, or dropped into slides or a paper.

const PROPS = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-size", "font-weight", "font-family", "paint-order", "text-anchor"];

export function svgPicture(svg: SVGSVGElement, full: { width: number; height: number }): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll("*")];
  const to = [copy, ...copy.querySelectorAll("*")];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const target = to[i] as SVGElement;
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) target.style.setProperty(p, v);
    }
  });
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("viewBox", `0 0 ${full.width} ${full.height}`);
  copy.setAttribute("width", String(full.width));
  copy.setAttribute("height", String(full.height));
  copy.removeAttribute("style");
  copy.removeAttribute("class");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "-20");
  bg.setAttribute("y", "-20");
  bg.setAttribute("width", String(full.width + 40));
  bg.setAttribute("height", String(full.height + 40));
  bg.setAttribute("fill", getComputedStyle(svg).backgroundColor || "#fff");
  copy.insertBefore(bg, copy.firstChild);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`;
}

export function downloadSvg(svg: SVGSVGElement, full: { width: number; height: number }, name: string) {
  const blob = new Blob([svgPicture(svg, full)], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
