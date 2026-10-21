import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./icons";

/** Where a working panel sits: a window over the app, or snapped to the right or the bottom edge, beside the library and the reader. */
export type Place = "modal" | "right" | "bottom";

export interface DockTab {
  label: string;
  active: boolean;
  onClick(): void;
}

const SIZE_KEY = "lightkone.dock.size";
const WIDE = "(min-width: 900px)";

/** Whether the screen is wide enough to snap panels beside the papers; phones keep windows. */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof matchMedia === "function" && matchMedia(WIDE).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const m = matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/** The size a dock was dragged to last: its width on the right, its height at the bottom, in pixels. */
export function dockSize(where: "right" | "bottom"): number {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY) || "{}")[where];
    if (typeof v === "number" && v > 200) return v;
  } catch {
    // private window
  }
  return where === "right" ? 440 : 320;
}
function keepSize(where: "right" | "bottom", px: number) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(SIZE_KEY) || "{}"), [where]: Math.round(px) }));
  } catch {
    // private window
  }
}

/**
 * The frame of a panel that can be snapped: as a window it sits over the app
 * and closes on a click outside; snapped, it stays beside whatever you read,
 * with a grip to resize it and tabs when it shares its edge with another.
 */
export function PanelFrame(props: {
  place: Place;
  label: string;
  title: ComponentChildren;
  class?: string;
  hidden?: boolean;
  busy?: boolean;
  tabs?: DockTab[];
  onPlace?(p: Place): void;
  onResize?(): void;
  onClose(): void;
  onClick?(e: MouseEvent): void;
  children: ComponentChildren;
}) {
  const docked = props.place !== "modal";
  const self = useRef<HTMLElement>(null);

  function grip(e: PointerEvent) {
    if (!docked) return;
    e.preventDefault();
    const where = props.place as "right" | "bottom";
    const root = document.documentElement;
    const move = (ev: PointerEvent) => {
      const px = where === "right" ? innerWidth - ev.clientX : innerHeight - ev.clientY;
      const max = where === "right" ? innerWidth * 0.7 : innerHeight * 0.75;
      const size = Math.max(280, Math.min(max, px));
      root.style.setProperty(where === "right" ? "--dock-right" : "--dock-bottom", `${size}px`);
      keepSize(where, size);
    };
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      props.onResize?.();
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  }

  const head = (
    <div class="ask-head panel-head">
      {props.tabs && props.tabs.length > 1 ? (
        <div class="dock-tabs" role="tablist">
          {props.tabs.map((t) => (
            <button key={t.label} role="tab" aria-selected={t.active} class={t.active ? "on" : ""} onClick={t.onClick}>{t.label}</button>
          ))}
        </div>
      ) : (
        <h2>{props.title}</h2>
      )}
      <div class="panel-tools">
        {props.onPlace && (
          <span class="snap">
            {props.place !== "right" && (
              <button class="icon-btn" disabled={props.busy} onClick={() => props.onPlace!("right")} title="Snap to the right, to keep it open beside your papers" aria-label="Snap to the right">
                <Icon name="dockRight" />
              </button>
            )}
            {props.place !== "bottom" && (
              <button class="icon-btn" disabled={props.busy} onClick={() => props.onPlace!("bottom")} title="Snap to the bottom" aria-label="Snap to the bottom">
                <Icon name="dockBottom" />
              </button>
            )}
            {docked && (
              <button class="icon-btn" disabled={props.busy} onClick={() => props.onPlace!("modal")} title="Open as a window" aria-label="Open as a window">
                <Icon name="window" />
              </button>
            )}
          </span>
        )}
        <button class="icon-btn" onClick={props.onClose} disabled={props.busy} aria-label="Close"><Icon name="x" /></button>
      </div>
    </div>
  );

  if (!docked) {
    return (
      <div class="overlay" hidden={props.hidden} onClick={(e) => e.target === e.currentTarget && !props.busy && props.onClose()}>
        <section ref={self} class={`panel ${props.class ?? ""}`} aria-label={props.label} onClick={props.onClick}>
          {head}
          {props.children}
        </section>
      </div>
    );
  }
  return (
    <section ref={self} class={`panel docked dock-${props.place} ${props.class ?? ""}`} hidden={props.hidden} aria-label={props.label} onClick={props.onClick}>
      <div class="dock-grip" onPointerDown={grip} title="Drag to resize" />
      {head}
      {props.children}
    </section>
  );
}
