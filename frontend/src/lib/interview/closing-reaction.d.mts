export const ANSWER_LOOKAHEAD_SECONDS: number;
export const MAX_CLOSING_REACTION_CALLS: number;
export const CLOSING_REACTION_MIN_WORDS: number;
export const CLOSING_REACTION_MAX_WAIT_MS: number;
export function isLastAnswerExpected(input: { elapsedSeconds: number; durationMinutes: number; finishAfter?: boolean; lookaheadSeconds?: number }): boolean;
export function isReactionCompatible(reaction: string, snapshot: string, finalTranscript: string): boolean;
export function startsWithAcknowledgement(text: string): boolean;
export function closingReactionVariants(reaction: string): string[];
export type ClosingReactionTracker<Context = unknown> = {
  update(key: string, snapshot: string, context?: Context): boolean;
  peek(key: string): { reaction: string; snapshot: string } | null;
  resolve(key: string, finalTranscript: string, options?: { waitMs?: number }): Promise<string | null>;
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
export function composeClosingLead<Context = unknown>(input: {
  tracker: ClosingReactionTracker<Context>;
  key: string;
  answer: string;
  acknowledge: boolean;
  canAcknowledge: boolean;
  playAcknowledgement: () => boolean;
  audio: boolean;
  pickWord: () => string | null;
  fallbackReaction?: string | null;
  onSource?: (source: "model" | "fallback" | "none") => void;
}): Promise<string | null>;

export const CLOSING_FALLBACK_REACTIONS: readonly string[];
export function pickClosingFallbackReaction(lastUsed?: string | null, random?: () => number): string;
