export type InterviewHandoffMetrics = {
  totalMs: number;
  vadFinalizationMs: number;
  queueWaitMs: number | null;
  whisperMs: number | null;
  decisionMs: number | null;
  synthesisMs: number | null;
  playbackStartMs: number | null;
  unaccountedMs: number;
  /** True when the decision and speech were prepared during the answer grace. */
  prepared: boolean;
};

export const handoffTimingStorageKey: string;
export function isHandoffTimingEnabled(): boolean;
export function createInterviewHandoffTiming(options?: {
  speechEndToFinalizationMs?: number;
  now?: () => number;
  onComplete?: (metrics: InterviewHandoffMetrics) => void;
}): { mark(stage: string): void; markPrepared(): void };

export type ListeningHandoffMetrics = { playbackEndedToListeningMs: number; preconnected: boolean };
export function createListeningHandoffTiming(options?: {
  now?: () => number;
  onComplete?: (metrics: ListeningHandoffMetrics) => void;
}): { markPlaybackEnded(): void; markListening(details?: { preconnected?: boolean }): void };
