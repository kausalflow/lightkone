import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";

/** How close to the bottom (in pixels) still counts as "at the latest". */
const NEAR = 32;

/** The box the chat scrolls in: the nearest one that can scroll and has more than fits, else the nearest that can scroll. */
function scroller(el: HTMLElement | null): HTMLElement {
  let first: HTMLElement | null = null;
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y !== "auto" && y !== "scroll") continue;
    if (p.scrollHeight > p.clientHeight + 1) return p;
    first ??= p;
  }
  return first ?? (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

function below(s: HTMLElement): number {
  return s.scrollHeight - s.scrollTop - s.clientHeight;
}

/**
 * Keeps a chat showing the latest text while Claude writes, but only while the reader is already at the bottom.
 * Scrolling up to read stops the following; scrolling back down (or "Jump to latest") picks it up again.
 * A new question (streaming going from nothing to "") always goes to the bottom.
 *
 * `end` is an empty element after the last message. Returns whether to offer "Jump to latest", and the jump.
 */
export function useFollow(end: RefObject<HTMLElement | null>, streaming: string | null, deps: unknown[]) {
  const pinned = useRef(true);
  const last = useRef(0);
  const box = useRef<HTMLElement | null>(null);
  const [away, setAway] = useState(false);
  const was = useRef<string | null>(null);

  function toBottom() {
    const s = box.current ?? scroller(end.current);
    s.scrollTop = s.scrollHeight;
    last.current = s.scrollTop;
    pinned.current = true;
    setAway(false);
  }

  // Follow the scroll box the chat sits in (it can change with layout, e.g. phone sheet vs side panel).
  useEffect(() => {
    const s = scroller(end.current);
    if (s === box.current) return;
    box.current = s;
    last.current = s.scrollTop;
    const target: HTMLElement | Window = s === document.scrollingElement ? window : s;
    const onScroll = () => {
      const top = s.scrollTop;
      const d = below(s);
      if (d <= NEAR && top >= last.current) pinned.current = true;
      // Only the reader moves the view up: text growing never does, and a page that shrinks leaves us at the bottom.
      else if (top < last.current - 1 && d > 2) pinned.current = false;
      last.current = top;
      setAway(!pinned.current && d > NEAR);
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (box.current === s) box.current = null;
    };
  });

  useLayoutEffect(() => {
    const started = streaming === "" && was.current !== "";
    was.current = streaming;
    if (started) pinned.current = true;
    const s = box.current ?? scroller(end.current);
    if (pinned.current) {
      if (below(s) > 0) {
        s.scrollTop = s.scrollHeight;
        last.current = s.scrollTop;
      }
      setAway(false);
    } else setAway(below(s) > NEAR);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, ...deps]);

  return { away, toBottom };
}

export function JumpLatest(props: { show: boolean; onJump: () => void; writing: boolean }) {
  if (!props.show) return null;
  // A zero-height holder: the button floats just above whatever comes next (the question box).
  return (
    <div class="jump-wrap">
      <button type="button" class="jump-latest" onClick={props.onJump}>
        {props.writing ? "↓ Latest · still writing" : "↓ Latest"}
      </button>
    </div>
  );
}
