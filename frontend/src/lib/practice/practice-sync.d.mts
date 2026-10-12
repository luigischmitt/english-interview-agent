export type PracticeErrorRef = { interview_id: string; sequence_number: number; evidence: string; rephrased: string; created_at?: string; type?: string; suggestion?: string };
export function errorKey(ref: PracticeErrorRef): string;
export function findMissingErrors(errors: PracticeErrorRef[], themes: Array<{ error_refs?: PracticeErrorRef[] }>): PracticeErrorRef[];
export function mergeRefs(existing?: PracticeErrorRef[], incoming?: PracticeErrorRef[]): PracticeErrorRef[];
export function applyPracticeResult(theme: { correct_streak: number; status: "active" | "mastered" | "hidden" }, verdict: "correct" | "almost" | "incorrect"): { correct_streak: number; status: "active" | "mastered" | "hidden" };
export function sortThemes<T extends { theme_key: string; status: string; weighted_frequency: number; last_error_at: string | null }>(themes: T[]): T[];
