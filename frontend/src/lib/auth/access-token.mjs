export const sessionExpiredMessage = "Sua sessão expirou. Entre novamente para continuar.";
export const sessionExpiredEvent = "english-interview-agent:session-expired";

export class UnauthenticatedError extends Error {
  constructor() {
    super(sessionExpiredMessage);
    this.name = "UnauthenticatedError";
    this.isUnauthenticated = true;
  }
}

/** Tells the UI (one banner) that the backend rejected the session; never carries the token. */
export function notifySessionExpired(target = globalThis) {
  if (typeof target.dispatchEvent === "function" && typeof Event === "function") target.dispatchEvent(new Event(sessionExpiredEvent));
}

export function onSessionExpired(callback, target = globalThis) {
  if (typeof target.addEventListener !== "function") return () => {};
  target.addEventListener(sessionExpiredEvent, callback);
  return () => target.removeEventListener(sessionExpiredEvent, callback);
}

/** `getSession` resolves to a Supabase session (or null). No session means the user must sign in again. */
export function createAccessTokenReader(getSession, target = globalThis) {
  return async function getAccessToken() {
    let session = null;
    try {
      session = await getSession();
    } catch {
      session = null;
    }
    const token = session?.access_token;
    if (typeof token !== "string" || token === "") {
      notifySessionExpired(target);
      throw new UnauthenticatedError();
    }
    return token;
  };
}

/** fetch with `Authorization: Bearer <access token>`; a 401 response also raises the session-expired notice. */
export function createAuthorizedFetch(getAccessToken, fetcher = (...args) => fetch(...args), target = globalThis) {
  return async function authorizedFetch(input, init = {}) {
    const token = await getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    const response = await fetcher(input, { ...init, headers });
    if (response.status === 401) notifySessionExpired(target);
    return response;
  };
}

/** First message of the transcription socket; browsers cannot set headers, so the token travels in the message. */
export function buildStreamStartMessage({ accessToken, speechThreshold, sampleRate, question }) {
  return {
    type: "start",
    version: 2,
    sampleRate,
    channels: 1,
    encoding: "s16le",
    speechThreshold,
    accessToken,
    ...(question ? { question } : {}),
  };
}
