import type { ProgressPoint } from "./progress-insights.mjs";

export type VoiceTrendMetric = "accuracy" | "fluency" | "prosody";
export type VoiceTrendRow = { id: string; date: string | null; label: string; values: Record<VoiceTrendMetric, number | null> };

export const voiceTrendMetrics: VoiceTrendMetric[];
export const voiceTrendCopy: Record<VoiceTrendMetric, { label: string; measure: string }>;
export function mergeVoiceSeries(series: Partial<Record<VoiceTrendMetric, ProgressPoint[]>> | null | undefined): VoiceTrendRow[];
export function voiceTrendDomain(rows: VoiceTrendRow[]): [number, number];
export function voiceMetricSummary(rows: VoiceTrendRow[], metric: VoiceTrendMetric): { latest: number; first: number; change: number | null; count: number } | null;
