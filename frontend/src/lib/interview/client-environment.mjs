/** Platform family from capability checks and the UA family only (never the full UA string). */
export function detectPlatform(nav = typeof navigator === "undefined" ? undefined : navigator) {
  if (!nav) return "desktop";
  const agent = typeof nav.userAgent === "string" ? nav.userAgent : "";
  if (/iP(hone|ad|od)/u.test(agent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1)) return "ios";
  if (/Android/u.test(agent)) return "android";
  return "desktop";
}

/** iOS/iPadOS: every browser there is WebKit, which routes media output differently while a microphone is open. */
export const isIosWebKit = (nav) => detectPlatform(nav) === "ios";

const audioSessionTypes = new Set(["auto", "playback", "transient", "transient-solo", "ambient", "play-and-record"]);

/** navigator.audioSession.type (WebKit Audio Session API) when present and known. */
export function readAudioSessionType(nav = typeof navigator === "undefined" ? undefined : navigator) {
  const type = nav?.audioSession?.type;
  return typeof type === "string" && audioSessionTypes.has(type) ? type : undefined;
}

/** Declares the page's audio as play-and-record so output stays audible while the mic is open. Returns whether it was set. */
export function setAudioSessionType(type, nav = typeof navigator === "undefined" ? undefined : navigator) {
  try {
    if (!nav?.audioSession || !audioSessionTypes.has(type)) return false;
    nav.audioSession.type = type;
    return true;
  } catch {
    return false;
  }
}

const knownErrorNames = new Set(["NotAllowedError", "NotSupportedError", "AbortError", "NotFoundError", "InvalidStateError", "EncodingError", "NotReadableError", "SecurityError", "OverconstrainedError", "TypeError", "Error", "MediaError"]);

/** A whitelisted error name (never the message). */
export function errorNameOf(error) {
  const name = error?.name;
  return typeof name === "string" && knownErrorNames.has(name) ? name : "other";
}

/** A content-free snapshot of a media element or Web Audio track. */
export function describeMedia(media) {
  if (!media) return {};
  const ms = (seconds) => (Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : undefined);
  const snapshot = {
    mediaMuted: typeof media.muted === "boolean" ? media.muted : undefined,
    mediaVolume: typeof media.volume === "number" ? media.volume : undefined,
    mediaPaused: typeof media.paused === "boolean" ? media.paused : undefined,
    mediaCurrentTimeMs: ms(media.currentTime),
    mediaDurationMs: ms(media.duration),
    readyState: typeof media.readyState === "number" ? media.readyState : undefined,
  };
  return Object.fromEntries(Object.entries(snapshot).filter(([, value]) => value !== undefined));
}

/** Tokens of in-app browsers (WebViews inside another app) that reject getUserMedia without ever prompting. */
const inAppBrowserPatterns = [
  ["google", /\bGSA\//u],
  ["instagram", /Instagram/u],
  ["facebook", /FBAN|FBAV|FB_IAB|FBIOS/u],
  ["linkedin", /LinkedInApp/u],
  ["tiktok", /musical_ly|TikTok|BytedanceWebview/u],
  ["line", /\bLine\//u],
];

/** The in-app browser family named by a user agent ("google" | "instagram" | "facebook" | "linkedin" | "tiktok" | "line"), or null. */
export function detectInAppBrowser(userAgent) {
  if (typeof userAgent !== "string" || !userAgent) return null;
  for (const [name, pattern] of inAppBrowserPatterns) if (pattern.test(userAgent)) return name;
  return null;
}

export const isAndroid = (nav) => detectPlatform(nav) === "android";

/** A link that asks the OS to open this https page in the system browser (Safari on iOS, Chrome on Android), or null. */
export function openInSystemBrowserUrl(currentUrl, platform) {
  let url;
  try { url = new URL(currentUrl); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (platform === "ios") return `x-safari-https://${url.host}${url.pathname}${url.search}${url.hash}`;
  if (platform === "android") return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=https;package=com.android.chrome;end`;
  return null;
}
