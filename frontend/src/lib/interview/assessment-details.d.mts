export type AssessmentPhrase = { phraseIndex: number; text: string; startMs: number; endMs: number; score: number; issue: "pronunciation" | "intonation"; problemWords: Array<{ word: string; score: number | null; errorType: string | null; worstPhoneme: string | null; prosodyErrors: string[] }> };
export type AssessmentDelivery = { wordsPerMinute: number; pauseCount: number; longestPauseMs: number; startDelayMs: number; fillerCount: number; fillers: Record<string, number> };
export type AssessmentClip = { phraseIndex: number; startMs: number; endMs: number; mimeType: "audio/webm;codecs=opus"; base64: string };
export type AssessmentDetails = { phrases?: AssessmentPhrase[]; delivery?: AssessmentDelivery; clips?: AssessmentClip[] };
export function validateAssessmentDetails(value: unknown): AssessmentDetails;
