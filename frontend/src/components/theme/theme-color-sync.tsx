"use client";

import { useEffect } from "react";

/** Page ground per scheme (--ds-cream), used for the browser chrome / iOS status bar. */
export const THEME_COLORS = { light: "#f3f4ee", dark: "#121316" } as const;

/**
 * The `theme-color` tags from the viewport export follow the OS scheme. The in-app toggle can disagree with the OS,
 * so mirror <html data-color-scheme> into every theme-color tag (including the first paint after hydration).
 */
export function ThemeColorSync() {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      const color = root.getAttribute("data-color-scheme") === "dark" ? THEME_COLORS.dark : THEME_COLORS.light;
      const tags = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
      if (tags.length === 0) {
        const tag = document.createElement("meta");
        tag.name = "theme-color";
        tag.content = color;
        document.head.appendChild(tag);
        return;
      }
      tags.forEach((tag) => { if (tag.content !== color) tag.content = color; });
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-color-scheme"] });
    return () => observer.disconnect();
  }, []);
  return null;
}
