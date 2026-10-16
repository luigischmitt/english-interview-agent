import type { ProgressRecord } from "./progress-insights.mjs";

export type PronunciationPhrase = {
  phraseIndex: number;
  text: string;
  issue: "pronunciation" | "intonation";
  problemWords: Array<{ word: string; score?: number | null; errorType?: string | null; worstPhoneme?: string | null; prosodyErrors?: string[] }>;
  date: string | null;
  answerNumber: number;
  clipPath: string | null;
  interviewId?: string;
  completedAt?: string | null;
};
export type PronunciationFamily = { id: string; label: string; tip: string; count: number; examples: string[] };
export function buildPronunciationInsights(records: ProgressRecord[]): { families: PronunciationFamily[]; phrases: PronunciationPhrase[] };
