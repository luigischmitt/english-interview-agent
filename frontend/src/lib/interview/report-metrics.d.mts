export type AzureReportDimension = "accuracy" | "fluency" | "prosody";
export type AzureAssessmentSample = { durationMs?: number } & (
  | { status: "pending" | "unavailable" }
  | { status: "available"; scores: Record<AzureReportDimension, number | null> }
);
export type AzureDimensionSummary = { mean: number | null; sampleCount: number; /** Assessed speech behind the mean; null/absent when unknown (older saved reports). */ totalDurationMs?: number | null };
export type AzureMetricSummary = Record<AzureReportDimension, AzureDimensionSummary>;
export type AzureMetricReliability = "none" | "insufficient" | "limited" | "ok";
export const insufficientAzureAudioMs: number;
export const limitedAzureAudioMs: number;
export function azureMetricReliability(metric: AzureDimensionSummary | null | undefined): AzureMetricReliability;
export function summarizeAzureAssessments(assessments: AzureAssessmentSample[]): AzureMetricSummary;
export type InterviewReportTurnSource = { sequenceNumber: number; speaker: "interviewer" | "candidate"; content: string | null };
export type InterviewReportTurn = { sequenceNumber: number; question: string; answer: string };
export function appendInterviewReportPair(turns: InterviewReportTurnSource[], pair: { questionSequenceNumber: number; candidateSequenceNumber: number; question: string; answer: string }): InterviewReportTurnSource[];
export function pairInterviewTurns(turns: InterviewReportTurnSource[]): InterviewReportTurn[];
export function answerOrdinalForSequence(turns: InterviewReportTurn[], sequenceNumber: number): number | null;
