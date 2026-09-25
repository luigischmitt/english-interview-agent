export type SpeechPlaybackResult =
  | { status: "completed" }
  | { status: "unavailable"; message: string }
  | { status: "cancelled" };

export type SpeechPlayback = {
  promise: Promise<SpeechPlaybackResult>;
  cancel: () => void;
};

export type SpeechPlaybackOptions = {
  endpoint: string;
  /** Deadline for the speech request and complete audio response body. */
  timeoutMs?: number;
  /** Maximum time to wait for play() and the media ended event. Defaults to a text-length estimate. */
  playbackTimeoutMs?: number;
  fetcher?: typeof fetch;
  makeAudio?: (url: string) => HTMLAudioElement;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (id: number) => void;
  onSegment?: (segment: string) => void;
};

export function composeOpeningUtterance(introduction: string, firstQuestion: string): string;
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
export function playInterviewerSegments(segments: string[], options: SpeechPlaybackOptions): SpeechPlayback;
