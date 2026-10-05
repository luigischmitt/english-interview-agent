export type ToucanState = "idle" | "speaking" | "listening" | "thinking";

export type SpeechFeedChunk = {
  chunkIndex: number;
  chunkCount?: number;
  endsWithQuestion?: boolean;
  /** The received audio, decoded here with a shared offline context unless `decodeAudio` is given. */
  blob?: Blob;
  /** Already-decoded audio (iOS Web Audio path): used instead of decoding the blob again. */
  decodeAudio?: () => Promise<{ getChannelData(channel: number): Float32Array; sampleRate: number }>;
  /** Playback position of this chunk in seconds. */
  clock: () => number;
  isPlaying: () => boolean;
};

export type SpeechFeedSample = { id: number; features: AudioFeatures | null; failed: boolean; pos: number; endsWithQuestion: boolean };
export type SpeechFeed = {
  push(info: SpeechFeedChunk): void;
  reset(): void;
  sample(now: number): SpeechFeedSample | null;
  readonly size: number;
};

export type AudioFeatures = {
  env: ArrayLike<number>;
  cons: Float32Array;
  gain: Float32Array;
  events: { t: number; s: number }[];
  pauses: { t0: number; t1: number }[];
  dur: number;
  hopT: number;
  n: number;
};

export const clamp: (v: number, a: number, b: number) => number;
export const smoothstep: (a: number, b: number, x: number) => number;
export const sat: (x: number, limit: number) => number;
export class Spring {
  constructor(value: number, omega: number, zeta?: number);
  x: number; v: number; t: number; w: number; z: number;
  step(dt: number): void;
}
export const valueNoise: (t: number, seed: number) => number;
export const noise: (t: number, seed: number) => number;
export const JAW: { omega: number; zeta: number; attack: number; release: number; chatter: number; chatterHz: number; lookahead: number; maxAngle: number };
export function analyseSamples(data: ArrayLike<number>, sampleRate: number, rng?: () => number): AudioFeatures;
export function analyseBuffer(buffer: { getChannelData(channel: number): Float32Array; sampleRate: number }, rng?: () => number): AudioFeatures;
export function beakTargetAt(features: AudioFeatures, pos: number, t: number): { target: number; chatter: number; env: number; cons: number };
export function genericBeakTarget(t: number): number;
export class JawModel { mouth: number; level: number; step(dt: number, target: number, chatter?: number): number }
export const NOD: { single: { A: number; dn: number; up: number }; double: { A: number; dn: number; up: number; at: number }[] };
export class NodScheduler { count: number; add(t0: number, kind: "single" | "double"): void; rotation(t: number): number }
export class PhraseListener {
  constructor(rng?: () => number);
  update(t: number, level: number, listening: boolean): { kind: "single" | "double" | "tilt"; at: number; a?: number } | null;
}
export const TOUCAN_STATES: ToucanState[];
export function toucanStateFor(input: { phase: string; audioPlaying?: boolean }): ToucanState;
export function createClockInterpolator(maxExtrapolation?: number): (raw: number, now: number) => number;
export function decodeBlobToBuffer(blob: Blob): Promise<{ getChannelData(channel: number): Float32Array; sampleRate: number }>;
export function createSpeechFeed(options?: { decode?: (blob: Blob) => Promise<{ getChannelData(channel: number): Float32Array; sampleRate: number }>; rng?: () => number; maxEntries?: number }): SpeechFeed;
export function mouthWedgePath(mouth: number): string;
export const REST_SKIN_PATH: string;
export const REST_BIB_PATH: string;
export function createToucanEngine(options: { root: ParentNode; rng?: () => number; reducedMotion?: () => boolean }): {
  setState(state: ToucanState, t: number): void;
  readonly state: ToucanState;
  setCandidateLevel(level: number): void;
  setFeed(feed: SpeechFeed | null): void;
  readonly nodCount: number;
  frame(t: number): void;
  resume(): void;
};
