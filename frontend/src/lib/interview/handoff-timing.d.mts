export type InterviewHandoffMetrics = {
  totalMs: number;
  vadFinalizationMs: number;
  queueWaitMs: number | null;
  whisperMs: number | null;
  decisionMs: number | null;
  synthesisMs: number | null;
  playbackStartMs: number | null;
  unaccountedMs: number;
};

export const handoffTimingStorageKey: string;
export function isHandoffTimingEnabled(): boolean;
export function createInterviewHandoffTiming(options?: {
  speechEndToFinalizationMs?: number;
  now?: () => number;
  onComplete?: (metrics: InterviewHandoffMetrics) => void;
}): { mark(stage: string): void };
