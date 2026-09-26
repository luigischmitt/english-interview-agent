export type AzureReportDimension = "accuracy" | "fluency" | "prosody";
export type AzureAssessmentSample = { durationMs?: number } & (
  | { status: "pending" | "unavailable" }
  | { status: "available"; scores: Record<AzureReportDimension, number | null> }
);
export type AzureMetricSummary = Record<AzureReportDimension, { mean: number | null; sampleCount: number }>;
export function summarizeAzureAssessments(assessments: AzureAssessmentSample[]): AzureMetricSummary;
export type InterviewReportTurnSource = { sequenceNumber: number; speaker: "interviewer" | "candidate"; content: string | null };
export type InterviewReportTurn = { sequenceNumber: number; question: string; answer: string };
export function pairInterviewTurns(turns: InterviewReportTurnSource[]): InterviewReportTurn[];
export function answerOrdinalForSequence(turns: InterviewReportTurn[], sequenceNumber: number): number | null;
