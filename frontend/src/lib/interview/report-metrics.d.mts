export type AzureReportDimension = "accuracy" | "fluency" | "prosody";
export type AzureAssessmentSample = { durationMs?: number } & (
  | { status: "pending" | "unavailable" }
  | { status: "available"; scores: Record<AzureReportDimension, number | null> }
);
export type AzureDimensionSummary = { mean: number | null; sampleCount: number; /** Assessed speech behind the mean; null/absent when unknown (older saved reports). */ totalDurationMs?: number | null };
export type AzureAnswerDelivery = { wordsPerMinute?: number; pauseCount?: number; longestPauseMs?: number; startDelayMs?: number; fillerCount?: number; fillers?: string[] };
export type AzureAnswerSentence = { sentenceIndex: number; text: string; startMs: number; endMs: number; score: number; problemWords?: Array<{ word: string; score: number; errorType?: string; worstPhoneme?: string }> };
export type AzureAnswerSummary = { sequenceNumber: number; scores: Record<AzureReportDimension, number | null>; durationMs: number; delivery?: AzureAnswerDelivery; sentences?: AzureAnswerSentence[]; clips?: Array<{ sentenceIndex: number; startMs: number; endMs: number; path: string }> };
export type AzureMetricSummary = { accuracy: AzureDimensionSummary; fluency: AzureDimensionSummary; prosody: AzureDimensionSummary; answers?: AzureAnswerSummary[] };
export type AzureMetricReliability = "none" | "insufficient" | "limited" | "ok";
export const insufficientAzureAudioMs: number;
export const limitedAzureAudioMs: number;
export function azureMetricReliability(metric: AzureDimensionSummary | null | undefined): AzureMetricReliability;
export function summarizeAzureAssessments(assessments: AzureAssessmentSample[]): AzureMetricSummary;
export function buildAzureAnswerRecords(entries: Array<{ sequenceNumber: number; state: unknown }>, clipPaths?: Record<string, string>): AzureAnswerSummary[];
export type InterviewReportTurnSource = { sequenceNumber: number; speaker: "interviewer" | "candidate"; content: string | null };
export type InterviewReportTurn = { sequenceNumber: number; question: string; answer: string };
export function appendInterviewReportPair(turns: InterviewReportTurnSource[], pair: { questionSequenceNumber: number; candidateSequenceNumber: number; question: string; answer: string }): InterviewReportTurnSource[];
export function pairInterviewTurns(turns: InterviewReportTurnSource[]): InterviewReportTurn[];
export function answerOrdinalForSequence(turns: InterviewReportTurn[], sequenceNumber: number): number | null;
