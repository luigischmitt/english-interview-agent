"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** useLayoutEffect on the client, useEffect during SSR (avoids the React server warning). */
export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** True when the user asked for less motion, or the browser cannot observe visibility: callers should render the final state. */
export function prefersStaticMotion() {
  if (typeof window === "undefined") return true;
  return !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Becomes true the first time the element is on screen and stays true (one-time entrance). Without
 * IntersectionObserver, or under reduced motion, it is true from the start so the final state shows immediately.
 */
export function useInViewOnce<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (prefersStaticMotion()) { setInView(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setInView(true); observer.disconnect(); }
    }, { threshold });
    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}
