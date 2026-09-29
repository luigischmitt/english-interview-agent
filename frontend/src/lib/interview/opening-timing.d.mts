export const openingTimingStorageKey: string;
export function isOpeningTimingEnabled(): boolean;
export function createOpeningSpeechTiming(options?: {
  now?: () => number;
  onComplete?: (metrics: { synthesisMs: number; playbackStartMs: number }) => void;
}): { mark: (stage: string) => void };
