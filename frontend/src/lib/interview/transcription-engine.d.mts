export type TranscriptionEngine = "whisper" | "ink-2";
export const defaultTranscriptionEngine: TranscriptionEngine;
export const transcriptionEngineOptions: ReadonlyArray<{ value: TranscriptionEngine; label: string; helper: string }>;
export function resolveTranscriptionEngine(config: { transcriptionEngine?: unknown } | null | undefined): TranscriptionEngine;
