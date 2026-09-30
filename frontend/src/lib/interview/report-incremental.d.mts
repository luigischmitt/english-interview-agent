export const turnAnalysisWaitMs: number;
export function collectTurnAnalyses<T extends { sequenceNumber: number }>(
  turns: Array<{ sequenceNumber: number }>,
  pendingBySequence: Map<number, PromiseLike<T | null | undefined> | T | null | undefined>,
  options?: { timeoutMs?: number },
): Promise<{ complete: boolean; analyses: T[]; missing: number }>;
export const turnAnalysisRetryDelayMs: number;
export const finalTurnAnalysisMs: number;
export function analyzeTurnWithRetry<T, A>(options: {
  turn: T;
  analyze: (turn: T, signal?: AbortSignal) => Promise<A>;
  signal?: AbortSignal;
  retryDelayMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onRetry?: () => void;
}): Promise<A | null>;
export function settleTurnAnalyses<A extends { sequenceNumber: number }>(
  turns: Array<{ sequenceNumber: number }>,
  pendingBySequence: Map<number, PromiseLike<A | null | undefined> | A | null | undefined>,
  options?: { timeoutMs?: number },
): Promise<Map<number, A>>;
export function missingSequenceNumbers(turns: Array<{ sequenceNumber: number }>, analysesBySequence: Map<number, unknown>): number[];
export function resolveReportAtEnd<T extends { sequenceNumber: number }, A, R>(options: {
  turns: T[];
  settled: PromiseLike<Map<number, A>> | Map<number, A>;
  analyze: (turn: T, signal: AbortSignal) => Promise<A | null | undefined>;
  consolidate: (analyses: A[]) => Promise<R>;
  fullReport: () => Promise<R>;
  finalAttemptMs?: number;
  signal?: AbortSignal;
  onEvent?: (event: string, details: Record<string, number>) => void;
}): Promise<{ result: R; path: "incremental" | "fallback"; missingAtEnd: number; recoveredAtEnd: number }>;
