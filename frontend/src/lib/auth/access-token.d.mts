export const sessionExpiredMessage: string;
export const sessionExpiredEvent: string;
export class UnauthenticatedError extends Error {
  readonly isUnauthenticated: true;
}
export function notifySessionExpired(target?: EventTarget): void;
export function onSessionExpired(callback: () => void, target?: EventTarget): () => void;
export function createAccessTokenReader(getSession: () => Promise<{ access_token?: string } | null | undefined>, target?: EventTarget): () => Promise<string>;
export function createAuthorizedFetch(getAccessToken: () => Promise<string>, fetcher?: typeof fetch, target?: EventTarget): typeof fetch;
export function buildStreamStartMessage(input: { accessToken: string; speechThreshold: number; sampleRate: number; captions?: boolean; question?: string | null; transcriptionEngine?: "whisper" | "ink-2" }): Record<string, unknown>;
