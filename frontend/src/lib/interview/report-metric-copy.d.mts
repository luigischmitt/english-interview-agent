import type { AzureReportDimension } from "./report-metrics.mjs";
export const azureMetricCopy: Record<AzureReportDimension, { label: string; help: string }>;
export const azureReportIntro: string;
export const azureReliabilityCopy: { insufficient: string; limited: string };
export const clarityHelp: string;
export const technicalContentHelp: string;
export const englishPatternsHelp: string;
export const coverageHelp: string;
export function answerCountLabel(count: number): string;
