export const FIXED_HANDOFF_RETAIN_MS: number;
export type FixedSpeechPreparation = { promise: Promise<boolean>; cancel(): void };
export type FixedHandoffEntry = {
  turnId: string; voiceKey: string; transition: string; questions: Array<{ id: string; prompt: string }>;
  startedAt: number; readyAt: number | null; readyCount: number; settledCount: number; failedCount: number; cancelled: boolean; used: boolean;
  handles: FixedSpeechPreparation[];
};
export function createFixedHandoffPreparationRegistry(options?: { now?: () => number; createTurnId?: () => string }): {
  begin(input: { voiceKey?: string; transition: string; questions: Array<{ id: string; prompt: string }>; prepareSpeech(text: string): FixedSpeechPreparation }): FixedHandoffEntry;
  take(input: { turnId: string; voiceKey?: string }): FixedHandoffEntry | null;
  peek(): FixedHandoffEntry | null;
  cancel(): FixedHandoffEntry | null;
  metrics(entry: FixedHandoffEntry, completedAt?: number): { turnId: string; plannedCount: number; readyCount: number; startedBeforeCompleteMs: number; readyBeforeCompleteMs: number };
};
