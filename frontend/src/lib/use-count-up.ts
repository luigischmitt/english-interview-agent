"use client";

import { useEffect, useRef, useState } from "react";
import { prefersStaticMotion, useIsomorphicLayoutEffect } from "./use-in-view";

// Quadratic ease-out: the climb stays visible to the end instead of jumping most of the way in the first frames.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 2);
/** A count shorter than this reads as a jump, not a climb. */
const minDurationMs = 1500;

/**
 * Counts a number up from 0 once its element is well inside the screen and its section has been revealed (≥1.5s, ease-out, after a short `delay` so it starts as
 * its section settles). The first render and SSR show the final value, so nothing is missing without JS; the value resets
 * to 0 only on the client, before the first paint. Later changes of `value` (a genuine content change) tween from what is
 * shown to the new value in a shorter run. Under reduced motion the final value is always shown.
 */
export function useCountUp<T extends Element>(value: number, { duration = 1800, delay = 450, threshold = 0.6 } = {}) {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(value);
  const state = useRef({ played: false, current: value, target: value, frame: 0, timer: 0 });

  const run = (from: number, to: number, ms: number) => {
    cancelAnimationFrame(state.current.frame);
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / ms);
      const next = from + (to - from) * easeOut(progress);
      state.current.current = next;
      setShown(next);
      if (progress < 1) state.current.frame = requestAnimationFrame(tick);
    };
    state.current.frame = requestAnimationFrame(tick);
  };

  useIsomorphicLayoutEffect(() => {
    const s = state.current;
    s.target = value;
    if (prefersStaticMotion()) { s.played = true; s.current = value; setShown(value); return; }
    if (s.played) { if (s.current !== value) run(s.current, value, 450); return; }
    s.current = 0;
    setShown(0);
    const element = ref.current;
    if (!element) { s.played = true; setShown(value); return; }
    // Start only when the number sits well inside the viewport AND its revealing section (if any) has played its entrance.
    const section = element.closest<HTMLElement>("[data-inview]");
    let watcher: MutationObserver | null = null;
    const start = () => {
      s.played = true;
      const lead = parseFloat(getComputedStyle(element).getPropertyValue("--rd")) || 0;
      s.timer = window.setTimeout(() => run(0, s.target, Math.max(duration, minDurationMs)), lead + delay);
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      if (!section || section.getAttribute("data-inview") !== "false") { start(); return; }
      watcher = new MutationObserver(() => {
        if (section.getAttribute("data-inview") === "false") return;
        watcher?.disconnect();
        start();
      });
      watcher.observe(section, { attributes: true, attributeFilter: ["data-inview"] });
    }, { threshold, rootMargin: "0px 0px -15% 0px" });
    observer.observe(element);
    return () => { observer.disconnect(); watcher?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => () => { cancelAnimationFrame(state.current.frame); clearTimeout(state.current.timer); }, []);
  return [ref, shown] as const;
}
