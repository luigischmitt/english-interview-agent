"use client";

import { type RefObject } from "react";
import { useIsomorphicLayoutEffect } from "./use-in-view";

/**
 * Marks each `[data-reveal]` element while it is on screen. Surfaces that can be temporarily hidden may opt into
 * `once`, which keeps a revealed section visible after its first entrance.
 * Without IntersectionObserver or under reduced motion nothing is marked, and the CSS keeps the content visible.
 */
export function useReplayReveal(rootRef: RefObject<HTMLElement | null>, deps: readonly unknown[] = [], { once = false } = {}) {
  useIsomorphicLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = root.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!targets.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && (once || entry.intersectionRatio >= 0.2)) {
          entry.target.setAttribute("data-inview", "true");
          if (once) observer.unobserve(entry.target);
        } else if (!entry.isIntersecting && !once) {
          entry.target.setAttribute("data-inview", "false");
        }
      }
    }, { threshold: once ? 0 : [0, 0.2] });
    targets.forEach((target) => {
      if (once && target.dataset.inview === "true") return;
      target.setAttribute("data-inview", "false");
      observer.observe(target);
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
