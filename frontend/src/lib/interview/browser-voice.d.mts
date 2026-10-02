export type BrowserVoiceOptions = {
  /** Defaults to window.speechSynthesis; injectable for tests. */
  speechSynthesis?: SpeechSynthesis;
  makeUtterance?: (text: string) => SpeechSynthesisUtterance;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (id: number) => void;
};

export type BrowserVoiceSpeakOptions = BrowserVoiceOptions & {
  /** Pre-resolved voice (or null for the engine default); loaded and cached when omitted. */
  voice?: SpeechSynthesisVoice | null;
  rate?: number;
  pitch?: number;
  /** Fired once, when the first sentence starts being spoken. */
  onStart?: () => void;
  /** Fired when each sentence starts being spoken. */
  onSegment?: (sentence: string, index: number) => void;
  onEnd?: () => void;
};

export type BrowserVoiceResult = { status: "completed" | "cancelled" | "unavailable" };

export const browserVoiceRate: number;
export const browserVoicePitch: number;
export const voicesWaitMs: number;
export function pickBrowserVoice<T extends { name?: string; lang?: string; localService?: boolean }>(voices: readonly T[] | null | undefined): T | null;
export function isBrowserVoiceAvailable(options?: BrowserVoiceOptions): boolean;
export function loadBrowserVoice(options?: BrowserVoiceOptions): Promise<SpeechSynthesisVoice | null>;
export function speakWithBrowserVoice(input: string | string[], options?: BrowserVoiceSpeakOptions): { promise: Promise<BrowserVoiceResult>; cancel: () => void };
