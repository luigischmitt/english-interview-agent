"use client";

import { useRef, type RefObject } from "react";
import { useIsomorphicLayoutEffect } from "./use-in-view";

/** First entrance of a screen waits for its title to start forming; blocks that arrive later (after data) play at once. */
const entranceLeadMs = 380;
const blockStaggerMs = 90;

/**
 * Marks each `[data-reveal]` element while it is on screen. Surfaces that can be temporarily hidden may opt into
 * `once`, which keeps a revealed section visible after its first entrance.
 * Each block gets a `--rd` delay: blocks that come into view together rise one after another, and the first ones of a
 * screen wait for the title. Call it after the data is ready (its deps change when the sections mount): skeletons carry no
 * `data-reveal`, so entrances never play on loading states.
 * Without IntersectionObserver or under reduced motion nothing is marked, and the CSS keeps the content visible.
 */
export function useReplayReveal(rootRef: RefObject<HTMLElement | null>, deps: readonly unknown[] = [], { once = false } = {}) {
  const mountedAt = useRef<number | null>(null);
  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (mountedAt.current === null) mountedAt.current = performance.now();
    const targets = root.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!targets.length) return;
    const observer = new IntersectionObserver((entries) => {
      const lead = performance.now() - (mountedAt.current ?? 0) < 900 ? entranceLeadMs : 0;
      let order = 0;
      for (const entry of entries) {
        if (entry.isIntersecting && (once || entry.intersectionRatio >= 0.2)) {
          (entry.target as HTMLElement).style.setProperty("--rd", `${lead + order * blockStaggerMs}ms`);
          order += 1;
          entry.target.setAttribute("data-inview", "true");
          if (once) observer.unobserve(entry.target);
        } else if (!entry.isIntersecting && !once) {
          entry.target.setAttribute("data-inview", "false");
        }
      }
    }, { threshold: once ? 0 : [0, 0.2], rootMargin: once ? "0px 0px -10% 0px" : "0px" });
    targets.forEach((target) => {
      if (once && target.dataset.inview === "true") return;
      target.setAttribute("data-inview", "false");
      observer.observe(target);
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
