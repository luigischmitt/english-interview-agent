"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { detectInAppBrowser, detectPlatform, openInSystemBrowserUrl, type InAppBrowser } from "@/lib/interview/client-environment.mjs";

export type InAppBrowserInfo = {
  app: InAppBrowser;
  /** The system browser to name in the copy. */
  browserName: "Safari" | "Chrome";
  /** Deep link that opens this page in the system browser, or null when the platform has none. */
  openUrl: string | null;
  /** Name of the host app, with its article, for "O navegador do ...". */
  appLabel: string;
};

const appLabels: Record<InAppBrowser, string> = {
  google: "app do Google",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  line: "LINE",
};

let cached: InAppBrowserInfo | null | undefined;

function snapshot(): InAppBrowserInfo | null {
  if (typeof navigator === "undefined") return null;
  if (cached !== undefined) return cached;
  const app = detectInAppBrowser(navigator.userAgent);
  const platform = detectPlatform();
  cached = app ? { app, browserName: platform === "android" ? "Chrome" : "Safari", openUrl: openInSystemBrowserUrl(window.location.href, platform), appLabel: appLabels[app] } : null;
  return cached;
}

const subscribe = () => () => {};

/** The in-app browser the page runs in (null in a regular browser and during server rendering). */
export function useInAppBrowser(): InAppBrowserInfo | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Copies the current page link, with a textarea fallback; `copied` shows feedback for a few seconds. */
export function useCopyPageLink() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const copy = useCallback(async () => {
    const link = window.location.href;
    let ok = false;
    try {
      await navigator.clipboard.writeText(link);
      ok = true;
    } catch {
      try {
        const field = document.createElement("textarea");
        field.value = link;
        field.setAttribute("readonly", "");
        field.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(field);
        field.select();
        field.setSelectionRange(0, link.length);
        ok = document.execCommand("copy");
        field.remove();
      } catch { /* Copy is best effort. */ }
    }
    if (!ok) return;
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 3_000);
  }, []);
  return { copied, copy };
}

export const inAppMicTitle = (info: InAppBrowserInfo) => `Abra no ${info.browserName} para usar o microfone`;
export const inAppMicBody = (info: InAppBrowserInfo) => `O navegador do ${info.appLabel} não permite usar o microfone. Abra esta página no ${info.browserName} para responder por voz.`;
