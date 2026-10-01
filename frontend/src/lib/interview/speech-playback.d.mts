import type { BrowserVoiceOptions } from "./browser-voice.mjs";

export type SpeechPlaybackResult =
  | { status: "completed"; /** Which voice spoke; "browser" means the Web Speech fallback was used. */ voice?: "network" | "browser" }
  | { status: "unavailable"; message: string }
  | { status: "cancelled" };

export type SpeechPlayback = {
  promise: Promise<SpeechPlaybackResult>;
  cancel: () => void;
};

export type SpeechPlaybackOptions = {
  endpoint: string;
  /** JSON request fields that affect synthesis; text is used when omitted. */
  requestBody?: Record<string, unknown>;
  /** How long the first audio may take before the browser voice speaks instead (default FIRST_AUDIO_FALLBACK_MS = 4000). Also the longest wait for a later chunk. */
  firstAudioFallbackMs?: number;
  /** Injectable Web Speech API pieces for the browser fallback voice. */
  browserVoice?: BrowserVoiceOptions & { voice?: SpeechSynthesisVoice | null };
  /** Fired when the browser voice starts speaking in place of (or after) the network audio. */
  onBrowserVoiceStarted?: () => void;
  /** prewarmInterviewerSpeech only: deadline for the speech request and complete audio response body. */
  timeoutMs?: number;
  /** Maximum time to wait for play() and the media ended event. Defaults to a text-length estimate. */
  playbackTimeoutMs?: number;
  /** Defaults to fetch; the app passes authorizedFetch so the backend receives the Supabase access token. */
  fetcher?: typeof fetch;
  /** Keep a finished blob reusable by an identical request for this long (prepared utterances only). */
  retainMs?: number;
  makeAudio?: (url: string) => HTMLAudioElement;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (id: number) => void;
  onSegment?: (segment: string) => void;
  onSynthesisStarted?: () => void;
  onSynthesisCompleted?: () => void;
  onPlaybackStarted?: () => void;
  /** playInterviewerSegments only: fired once when the final chunk is playing and at most `finalChunkLeadMs` of it remains (at its start if shorter). */
  onFinalChunkStarted?: () => void;
  finalChunkLeadMs?: number;
  /** Caption excerpts from one utterance, advanced against the single audio track duration (synthesizeInterviewerQuestion only; playInterviewerSegments derives them per chunk). */
  captionSegments?: string[];
};

export function composeOpeningUtterance(introduction: string, firstQuestion: string): string;
export function composeContextualOpening(config: { role?: string; seniority?: string; focus?: string; duration: string }, firstQuestion: string): string;
export function composeAcknowledgedQuestion(acknowledgement: string | null, question: string): string;
export function composeInterviewClosing(): string;
export function resolveSkippedQuestion(question: string): { question: string; acknowledgement: string };
export function splitInterviewerSpeech(text: string): string[];
export function resolveInterviewerCaption(input: {
  audioEnabled: boolean;
  isSpeaking: boolean;
  playbackFailed: boolean;
  activeSegment: string | null;
  firstSegment: string | undefined;
  fallbackText: string;
  questionPrompt: string;
}): string;
export function synthesizeInterviewerQuestion(text: string, options: SpeechPlaybackOptions): SpeechPlayback;
export const FIRST_AUDIO_FALLBACK_MS: number;
export const speechUnavailableMessage: string;
export const minimumChunkCharacters: number;
export const finalChunkLeadMs: number;
export const maxConcurrentChunkRequests: number;
/** Groups sentences into synthesis chunks; sentences under ~40 characters merge with the next, none is ever split. */
export function groupInterviewerSentences(segments: string[]): { text: string; sentences: string[] }[];
export function playInterviewerSegments(segments: string[], options: SpeechPlaybackOptions): SpeechPlayback;
export function prewarmInterviewerSpeech(segments: string[], options: SpeechPlaybackOptions): { promise: Promise<boolean>; cancel: () => void };
export function clearRetainedSpeechBlobs(): void;
