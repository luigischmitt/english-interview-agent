import type { InterviewReportResult } from "./report";
export function findingsForAnswer(result: InterviewReportResult, sequenceNumber: number): { strengths: InterviewReportResult["technicalContent"]["strengths"]; gaps: InterviewReportResult["technicalContent"]["gaps"]; patterns: InterviewReportResult["englishCommunication"]["patterns"] };
export function summarizeDelivery(delivery: { wordsPerMinute?: number; pauseCount?: number; longestPauseMs?: number; fillerCount?: number } | undefined): { wordsPerMinute: number | null; pauseCount: number; longestPauseMs: number; fillerCount: number; hint: string | null } | null;
export function worstSentence(answer: { sentences?: Array<{ score: number }> } | undefined): { score: number; sentenceIndex: number; text: string; problemWords?: Array<{ word: string; score: number; errorType?: string; worstPhoneme?: string }> } | null;
export function phonemeHint(phoneme?: string): string | null;
