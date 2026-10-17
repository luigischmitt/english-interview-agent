export type OverviewPattern = { type: string; sequenceNumber: number; evidence?: string; rephrasedExample?: string; suggestion?: string; why?: string };
export type OverviewAnswer = { sequenceNumber: number; scores?: Record<string, number | null>; delivery?: { wordsPerMinute?: number; fillerCount?: number } };
export type OverviewResult = { overview?: { technical?: string; english?: string }; technicalContent?: { strengths?: unknown[]; gaps?: unknown[] }; englishCommunication?: { patterns?: unknown[] } };
export function groupPatternsByType(patterns?: OverviewPattern[]): Array<{ type: string; items: OverviewPattern[] }>;
export function deriveOverviewTiles(result: OverviewResult, answers?: OverviewAnswer[]): Array<{ id: string; title: string; text: string | null }>;
