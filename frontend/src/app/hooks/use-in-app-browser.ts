"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { detectInAppBrowser, detectPlatform, openInSystemBrowserUrl, type InAppBrowser } from "@/lib/interview/client-environment.mjs";
import { getCurrentLocale } from "@/lib/locale";

export type InAppBrowserInfo = {
  app: InAppBrowser;
  /** The system browser to name in the copy. */
  browserName: "Safari" | "Chrome";
  /** Deep link that opens this page in the system browser, or null when the platform has none. */
  openUrl: string | null;
  /** Name of the host app, with its article, for "O navegador do ...". */
  appLabel: string;
  /** The host app's name as it appears in the phone's settings list. */
  settingsName: string;
  platform: "ios" | "android" | "desktop";
};

const settingsNames: Record<InAppBrowser, string> = {
  google: "Google",
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  line: "LINE",
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
  cached = app ? { app, browserName: platform === "android" ? "Chrome" : "Safari", openUrl: openInSystemBrowserUrl(window.location.href, platform), appLabel: appLabels[app], settingsName: settingsNames[app], platform } : null;
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

export const inAppMicTitle = (info: InAppBrowserInfo) => getCurrentLocale() === "en"
  ? `Allow microphone access for ${info.settingsName}`
  : `Libere o microfone para o ${info.settingsName}`;

/**
 * A web page can't open the phone's settings, so we spell out the path. In-app browsers ask for the mic only after the
 * host app itself has microphone access; once it's on, the page asks normally.
 */
export const inAppMicSteps = (info: InAppBrowserInfo) => getCurrentLocale() === "en"
  ? info.platform === "android"
    ? `Open Settings → Apps → ${info.settingsName} → Permissions and enable Microphone. Then come back and select “Try again.”`
    : `Open iPhone Settings → ${info.settingsName} and enable Microphone. Then come back and select “Try again.”`
  : info.platform === "android"
    ? `Abra Configurações → Apps → ${info.settingsName} → Permissões e ative o Microfone. Depois volte e toque em “Tentar novamente”.`
    : `Abra os Ajustes do iPhone → ${info.settingsName} e ative o Microfone. Depois volte e toque em “Tentar novamente”.`;

export const inAppMicBody = (info: InAppBrowserInfo) => getCurrentLocale() === "en"
  ? `You are in the ${info.appLabel} browser. It needs microphone access for you to answer by voice here. ${inAppMicSteps(info)} Or open this page in ${info.browserName}.`
  : `Você está no navegador do ${info.appLabel}. Para responder por voz aqui, ele precisa de acesso ao microfone. ${inAppMicSteps(info)} Ou abra esta página no ${info.browserName}.`;
