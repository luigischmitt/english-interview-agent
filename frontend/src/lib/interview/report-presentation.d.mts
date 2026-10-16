export function diffReportWords(original: string, revised: string): { original: Array<{ text: string; changed: boolean }>; revised: Array<{ text: string; changed: boolean }> };
export function buildReportDeltas(current: unknown, currentAzure: unknown, records: unknown[], currentInterviewId?: string, currentAnswerCount?: number): Array<{ label: string; before: string; after: string; change: "better" | "worse" | "same" }>;
export function phonemeTip(phoneme?: string | null, word?: string): string;
