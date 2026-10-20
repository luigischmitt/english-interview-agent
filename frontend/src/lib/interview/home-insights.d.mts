import type { ProgressRecord } from "./progress-insights.mjs";

export type HomeInsights = {
  interviewCount: number;
  lastInterviewAt: string | null;
  lastReportReady: boolean;
  lastTakeaway: string | null;
  topPattern: { type: string | null; suggestion: string } | null;
};

export function buildHomeInsights(records: ProgressRecord[] | unknown): HomeInsights;
