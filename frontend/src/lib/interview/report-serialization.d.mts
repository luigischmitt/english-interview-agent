import type { InterviewReportResult } from "./report";
export function serializeInterviewAnalysis(result: InterviewReportResult): Omit<InterviewReportResult, "model" | "analysisVersion">;
