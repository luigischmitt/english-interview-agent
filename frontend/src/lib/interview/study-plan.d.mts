import type { InterviewConfig } from "./types";
import type { InterviewReportResult, InterviewStudyPlan } from "./report";

export function buildInterviewStudyPlanPayload(config: InterviewConfig, report: InterviewReportResult): Record<string, unknown>;
export function normalizeInterviewStudyPlan(value: unknown): InterviewStudyPlan | null;
export function requestInterviewStudyPlan(config: InterviewConfig, report: InterviewReportResult, fetcher: typeof fetch, endpoint?: string): Promise<InterviewStudyPlan | null>;
export function serializeInterviewAnalysis(result: InterviewReportResult): Omit<InterviewReportResult, "model" | "analysisVersion">;
