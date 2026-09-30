export const turnAnalysisWaitMs: number;
export function collectTurnAnalyses<T extends { sequenceNumber: number }>(
  turns: Array<{ sequenceNumber: number }>,
  pendingBySequence: Map<number, PromiseLike<T | null | undefined> | T | null | undefined>,
  options?: { timeoutMs?: number },
): Promise<{ complete: boolean; analyses: T[]; missing: number }>;
