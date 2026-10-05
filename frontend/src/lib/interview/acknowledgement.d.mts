import type { SpeechPlaybackOptions } from "./speech-playback.mjs";

export const ACKNOWLEDGEMENT_PHRASES: string[];
export function pickAcknowledgement(input?: { phrases?: string[]; available?: string[]; recent?: string[]; lastPhrase?: string | null }): string | null;
export function stripLeadingAcknowledgement(text: string | null | undefined): string;

export type AcknowledgementHandle = { phrase: string; promise: Promise<void>; cancel: () => void };
export type AcknowledgementPlayer = {
  preload(): Promise<void>;
  readonly loadedCount: number;
  readonly lastPhrase: string | null;
  readonly playing: boolean;
  whenIdle(): Promise<void>;
  play(input?: { recent?: string[] }): AcknowledgementHandle | null;
  cancel(): void;
};
export function createAcknowledgementPlayer(options: {
  endpoint?: string;
  fetcher?: typeof fetch;
  phrases?: string[];
  loadBlob?: (phrase: string) => Promise<Blob>;
  makeAudio?: (url: string) => HTMLAudioElement;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  setTimeout?: (callback: () => void, delay: number) => number;
  clearTimeout?: (id: number) => void;
  maxPlayMs?: number;
  onChunkAudio?: SpeechPlaybackOptions["onChunkAudio"];
  onDiagnostic?: (event: { kind: string; [field: string]: unknown }) => void;
}): AcknowledgementPlayer;
