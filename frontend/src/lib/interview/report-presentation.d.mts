export function diffReportWords(original: string, revised: string): { original: Array<{ text: string; changed: boolean }>; revised: Array<{ text: string; changed: boolean }> };
export function isCompleteSentence(value: unknown): boolean;
export function displayTechnicalFindings<T extends { explanation?: unknown; evidence?: unknown }>(strengths?: T[], gaps?: T[], otherNegativeFindings?: Array<{ explanation?: unknown; evidence?: unknown }>): { strengths: T[]; gaps: T[] };
export function displayInterviewerTakeaway(takeaway: { remember?: unknown; concern?: unknown } | undefined, otherNegativeFindings?: Array<{ explanation?: unknown }>): { remember: string | null; concern: string | null };
export function hasIncompleteAnalysisCoverage(report: unknown): boolean;
export function analysisCoverageNotice(coverage: unknown, ordinalForSequence?: (sequenceNumber: number) => number | null): string | null;
export function buildReportDeltas(current: unknown, currentAzure: unknown, records: unknown[], currentInterviewId?: string, currentAnswerCount?: number): Array<{ label: string; before: string; after: string; change: "better" | "worse" | "same" }>;
export function phonemeTip(phoneme?: string | null, word?: string): string;
