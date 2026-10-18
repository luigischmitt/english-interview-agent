import type { AzureMetricSummary, AzureReportDimension } from "./report-metrics.mjs";

export function voiceMetricInterpretation(dimension: AzureReportDimension, metric: AzureMetricSummary[AzureReportDimension]): string;
export function voiceDeliveryInterpretation(answers: AzureMetricSummary["answers"]): {
  wordsPerMinute: number;
  pauseCount: number;
  longestPauseMs: number;
  fillerCount: number;
  insights: Array<{ key: string; values?: { fillers: string } }>;
  insight: string;
} | null;
