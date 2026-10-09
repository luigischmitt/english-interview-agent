export const ANSWER_LOOKAHEAD_SECONDS: number;
export const MAX_CLOSING_REACTION_CALLS: number;
export const CLOSING_REACTION_MIN_WORDS: number;
export const CLOSING_REACTION_MAX_WAIT_MS: number;
export function isLastAnswerExpected(input: { elapsedSeconds: number; durationMinutes: number; finishAfter?: boolean; lookaheadSeconds?: number }): boolean;
export function isReactionCompatible(reaction: string, snapshot: string, finalTranscript: string): boolean;
export function startsWithAcknowledgement(text: string): boolean;
export type ClosingReactionTracker<Context = unknown> = {
  update(key: string, snapshot: string, context?: Context): boolean;
  peek(): { reaction: string; snapshot: string } | null;
  resolve(finalTranscript: string, options?: { waitMs?: number }): Promise<string | null>;
  readonly callCount: number;
  cancel(): void;
};
export function createClosingReactionTracker<Context = unknown>(options: {
  request: (snapshot: string, signal: AbortSignal, context: Context) => Promise<string | null>;
  onReaction?: (reaction: string, snapshot: string, context: Context) => void;
  maxCalls?: number;
  minWords?: number;
  growthRatio?: number;
  minNewWords?: number;
}): ClosingReactionTracker<Context>;
