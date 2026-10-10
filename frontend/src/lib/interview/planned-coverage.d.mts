export const maximumPlannedQuestionCharacters: number;
export const maximumContextAnswers: number;
export type PlannedCoverage = "COVERED" | "PARTIAL" | "OPEN";
export function buildPlannedCoverageStartFields(input?: { plannedQuestion?: unknown; previousAnswers?: unknown[] }): { plannedQuestion?: string; contextAnswers?: string[] };
export function recordPlannedCoverage(coverageByEpoch: Map<number, PlannedCoverage>, status: { speechEpoch: number; coverage: unknown }, currentSpeechEpoch: number | null): boolean;
export function finalPlannedCoverage(coverageByEpoch: Map<number, PlannedCoverage>, finalSpeechEpoch: number | null): PlannedCoverage | undefined;
export function resolvePlannedCoveredSkip<Q extends { id: string }>(input: { coverage: PlannedCoverage | undefined; judgedQuestionId: string | null | undefined; selectedQuestionId: string | null | undefined; candidates: Q[]; excludedIds?: Iterable<string> }): { replacement: Q; skippedQuestionId: string } | null;
