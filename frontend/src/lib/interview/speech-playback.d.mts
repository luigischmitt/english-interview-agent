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
  /** Voice id sent with each speech request (a selectable voice; the server falls back to its default for unknown ids). */
  voice?: string;
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
  /** playInterviewerSegments only: elapsed silence between one audio chunk ending and the next beginning. */
  onInterChunkGap?: (gapMs: number) => void;
  /** playInterviewerSegments only: fired when a question-ending audio chunk begins playing. */
  onQuestionStarted?: () => void;
  /** playInterviewerSegments only: fired when the final audio chunk begins playing. */
  onFinalChunkPlaybackStarted?: () => void;
  /** playInterviewerSegments only: fired once when the final chunk is playing and at most `finalChunkLeadMs` of it remains (at its start if shorter). */
  onFinalChunkStarted?: () => void;
  finalChunkLeadMs?: number;
  /** playInterviewerSegments only: awaited once before the first chunk plays (after its audio arrived), e.g. while an instant acknowledgement is still audible. */
  beforePlayback?: () => Promise<unknown> | null | undefined;
  /**
   * playInterviewerSegments only: called once per chunk when its audio has arrived (before it plays) so the avatar can
   * lip-sync it. `blob` is the received audio; `decodeAudio` (Web Audio path) resolves the already-decoded buffer.
   * `clock()` is the chunk's playback position in seconds, `isPlaying()` whether it is the audible chunk. Must not throw.
   */
  onChunkAudio?: (chunk: {
    chunkIndex: number;
    chunkCount: number;
    endsWithQuestion: boolean;
    blob: Blob;
    decodeAudio?: () => Promise<{ getChannelData(channel: number): Float32Array; sampleRate: number }>;
    clock: () => number;
    isPlaying: () => boolean;
  }) => void;
  /** Caption excerpts from one utterance, advanced against the single audio track duration (synthesizeInterviewerQuestion only; playInterviewerSegments derives them per chunk). */
  captionSegments?: string[];
};

export function composeOpeningUtterance(introduction: string, firstQuestion: string): string;
export function composeContextualOpening(config: { role?: string; seniority?: string; focus?: string; duration: string }, firstQuestion: string): string;
export function composeAcknowledgedQuestion(acknowledgement: string | null, question: string): string;
export const INTERVIEW_CLOSINGS: readonly string[];
export function pickInterviewClosing(lastUsed?: string | null, random?: () => number): string;
export function composeInterviewClosing(reaction?: string | null, closing?: string): string;
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
/** Chunk 0 is requested alone; once it settles the remaining chunks start, at most this many in flight. */
export const maxConcurrentChunkRequests: number;
export const maximumChunkCharacters: number;
export const firstChunkSplitThreshold: number;
export const firstChunkPartMinimum: number;
export const firstChunkSentenceMaximum: number;
export const mergeBelowCharacters: number;
/**
 * Groups sentences into synthesis chunks. The first chunk is the first sentence (<= 70 characters) or its head up to the first
 * clause break (>= 25 characters); later chunks end only at sentence ends (short sentences merge, up to 180 characters; a
 * longer single sentence is split at a clause break). `text` is what is synthesized, `sentences` are the whole caption
 * sentences, `units` pair each spoken piece with its caption.
 */
export function groupInterviewerSentences(segments: string[]): { text: string; sentences: string[]; units: { text: string; caption: string }[] }[];
export function playInterviewerSegments(segments: string[], options: SpeechPlaybackOptions): SpeechPlayback;
export function prewarmInterviewerSpeech(segments: string[], options: SpeechPlaybackOptions): { promise: Promise<boolean>; firstChunkReady: Promise<boolean>; cancel: () => void };
export function fetchSpeechBlob(text: string, options: SpeechPlaybackOptions): Promise<Blob>;
export function clearRetainedSpeechBlobs(): void;
export function resetSpeechFlights(): void;

export function warmUpInterviewerSpeech(endpoint: string, fetcher: (input: string, init?: RequestInit) => Promise<unknown>): void;
