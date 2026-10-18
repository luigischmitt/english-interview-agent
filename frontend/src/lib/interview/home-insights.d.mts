import type { ProgressRecord } from "./progress-insights.mjs";

export type HomeInsights = {
  interviewCount: number;
  lastInterviewAt: string | null;
  lastReportReady: boolean;
  lastTakeaway: string | null;
  topPattern: { type: string | null; suggestion: string } | null;
  voiceFocus: { label: string; value: number; measure: string } | null;
};

export function buildHomeInsights(records: ProgressRecord[] | unknown): HomeInsights;
