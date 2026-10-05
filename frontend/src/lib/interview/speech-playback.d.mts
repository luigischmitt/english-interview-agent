export type SpeechPlaybackResult =
  | { status: "completed"; voice?: "network" }
  | { status: "unavailable"; message: string; /** "autoplay_blocked": the browser refused play() without a user gesture. */ reason?: "autoplay_blocked" }
  | { status: "cancelled" };

export type SpeechPlayback = {
  promise: Promise<SpeechPlaybackResult>;
  cancel: () => void;
};

export type SpeechPlaybackOptions = {
  endpoint: string;
  /** JSON request fields that affect synthesis; text is used when omitted. */
  requestBody?: Record<string, unknown>;
  /** Interviewer speech rate sent to the speech API (1 is the default and is omitted from the request). */
  speed?: number;
  /** Longest wait for the first audio (and for each later chunk) before playback ends as "unavailable" (default FIRST_AUDIO_TIMEOUT_MS = 20000). */
  firstAudioTimeoutMs?: number;
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
  /** Content-free per-chunk audio diagnostics (play call/result, playing, ended, error, timeout); must never throw. */
  onDiagnostic?: (event: { kind: string; [field: string]: unknown }) => void;
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
export const FIRST_AUDIO_TIMEOUT_MS: number;
export const speechUnavailableMessage: string;
export const autoplayBlockedMessage: string;
export const AUTOPLAY_BLOCKED_REASON: "autoplay_blocked";
export const minimumChunkCharacters: number;
export const finalChunkLeadMs: number;
export const maxConcurrentChunkRequests: number;
export const maximumChunkCharacters: number;
export const firstChunkSplitThreshold: number;
export const firstChunkPartMinimum: number;
/**
 * Groups sentences into synthesis chunks; sentences under ~40 characters merge with the next (never past ~140 characters).
 * Only the first sentence may be split (over 70 characters, at its first clause boundary). `text` is what is synthesized,
 * `sentences` are the whole caption sentences, `units` pair each spoken piece with its caption.
 */
export function groupInterviewerSentences(segments: string[]): { text: string; sentences: string[]; units: { text: string; caption: string }[] }[];
export function playInterviewerSegments(segments: string[], options: SpeechPlaybackOptions): SpeechPlayback;
export function prewarmInterviewerSpeech(segments: string[], options: SpeechPlaybackOptions): { promise: Promise<boolean>; cancel: () => void };
export function clearRetainedSpeechBlobs(): void;
export function resetSpeechFlights(): void;

export function warmUpInterviewerSpeech(endpoint: string, fetcher: (input: string, init?: RequestInit) => Promise<unknown>): void;
