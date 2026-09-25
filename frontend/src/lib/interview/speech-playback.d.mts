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
  timeoutMs?: number;
  fetcher?: typeof fetch;
  makeAudio?: (url: string) => HTMLAudioElement;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (id: number) => void;
};

export function synthesizeInterviewerQuestion(text: string, options: SpeechPlaybackOptions): SpeechPlayback;
