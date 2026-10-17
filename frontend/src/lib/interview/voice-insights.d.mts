import type { ProgressRecord } from "./progress-insights.mjs";

export type VoiceMetricKey = "accuracy" | "fluency" | "prosody";
export type VoicePhrase = { interviewId: string; date: string | null; answerNumber: number; phraseIndex: number; text: string; issue: "pronunciation" | "intonation"; score: number | null; problemWords: Array<{ word: string; score?: number | null; worstPhoneme?: string | null; prosodyErrors: string[] }>; clipPath: string | null };
export type VoiceTip = string | { key: string; values: Record<string, string> };
export type VoiceMetricInsight = { key: VoiceMetricKey; label: string; measure: string; heading: string; value: number | null; rawValue: number | null; reliability: "none" | "insufficient" | "limited" | "ok"; previousAverage: number | null; level: "good" | "attention" | "focus" | "unavailable"; tips: VoiceTip[]; phrases: VoicePhrase[] };
export const voiceMetrics: VoiceMetricKey[];
export const voiceMetricCopy: Record<VoiceMetricKey, Pick<VoiceMetricInsight, "label" | "measure" | "heading">>;
export function buildVoiceInsights(records: ProgressRecord[]): { hasVoiceData: boolean; latestDate: string | null; focus: VoiceMetricKey | null; metrics: VoiceMetricInsight[] };
