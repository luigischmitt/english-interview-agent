export type AssessmentSentence = { sentenceIndex: number; text: string; startMs: number; endMs: number; score: number; problemWords: Array<{ word: string; score: number | null; errorType: string | null; worstPhoneme: string | null }> };
export type AssessmentDelivery = { wordsPerMinute: number; pauseCount: number; longestPauseMs: number; startDelayMs: number; fillerCount: number; fillers: Record<string, number> };
export type AssessmentClip = { sentenceIndex: number; startMs: number; endMs: number; mimeType: "audio/webm;codecs=opus"; base64: string };
export type AssessmentDetails = { sentences?: AssessmentSentence[]; delivery?: AssessmentDelivery; clips?: AssessmentClip[] };
export function validateAssessmentDetails(value: unknown): AssessmentDetails;
