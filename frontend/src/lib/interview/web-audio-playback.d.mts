export const TRACK_TIME_UPDATE_MS: number;
export const CONTEXT_RESUME_TIMEOUT_MS: number;
export function shouldUseWebAudio(nav?: unknown, hasAudioContext?: boolean): boolean;
export function resetPlaybackContext(): void;
export function getPlaybackContext(create?: () => AudioContext): AudioContext;
export function peekPlaybackContext(): AudioContext | null;
export function unlockPlaybackContext(options?: { create?: () => AudioContext }): string;
export function createWebAudioTrack(url: string, deps?: Record<string, unknown>): HTMLAudioElement & { dispose(): void };
