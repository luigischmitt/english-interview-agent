export const FINAL_ANALYSIS_WAIT_MS: number;
export const FOLLOW_UP_TOTAL_WAIT_MS: number;
export function remainingBudgetMs(totalMs: number, startedAt: number, now: number): number;
type EntryView = { transcript: string; revision: number; settled: "pending" | "ready" };
export function pendingFinalAnalysisPredicate(entries: EntryView[], finalTranscript: string): ((entry: { transcript: string; revision: number }) => boolean) | null;
export function finalAnalysisWaitPredicate<T>(input: {
  eligible: boolean;
  entries: EntryView[];
  readyValues: T[];
  acceptFollowUp: (value: T) => boolean;
  finalTranscript: string;
}): ((entry: { transcript: string; revision: number }) => boolean) | null;
