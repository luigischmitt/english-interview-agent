"use client";

import { useEffect, type RefObject } from "react";

/**
 * Marks every `[data-reveal]` element inside `rootRef` with `data-inview="true"` while it is on screen and `"false"`
 * when it leaves, so CSS entrance animations play again each time the person scrolls back to them.
 * Without IntersectionObserver or under reduced motion nothing is marked, and the CSS keeps the content visible.
 */
export function useReplayReveal(rootRef: RefObject<HTMLElement | null>, deps: readonly unknown[] = []) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = root.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!targets.length) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        // Enter once a fifth is visible; leave only when fully gone, so the animation never flickers at the edge.
        if (entry.isIntersecting && entry.intersectionRatio >= 0.2) entry.target.setAttribute("data-inview", "true");
        else if (!entry.isIntersecting) entry.target.setAttribute("data-inview", "false");
      }
    }, { threshold: [0, 0.2] });
    targets.forEach((target) => {
      target.setAttribute("data-inview", "false");
      observer.observe(target);
    });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
