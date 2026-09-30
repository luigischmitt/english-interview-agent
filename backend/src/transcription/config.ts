export type TranscriptionConfig = {
  azureSpeechKey: string | null;
  azureSpeechRegion: string | null;
  openRouterApiKey: string | null;
  timeoutMs: number;
  assessmentEnabled: boolean;
  assessmentTimeoutMs: number;
  openRouterTimeoutMs: number;
  streamMaxDurationMs: number;
  streamMaxBytes: number;
  streamMaxActiveSessions: number;
  streamMaxConcurrentTranscriptions: number;
  streamMaxQueuedTranscriptions: number;
  vadTrailingSilenceMs: number;
  vadFinalizationGraceMs: number;
  vadAmbientActivityHoldMs: number;
  hedgeAfterMs: number;
};

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Transcription timeout must be a positive number.");
  }

  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const parsed = parsePositiveNumber(value, fallback);
  if (!Number.isInteger(parsed) || parsed > maximum) throw new Error(`Transcription limits must be positive integers no greater than ${maximum}.`);
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) throw new Error(`Transcription hedge delay must be an integer from 0 to ${maximum}.`);
  return parsed;
}

export function loadTranscriptionConfig(environment = process.env): TranscriptionConfig {
  return {
    azureSpeechKey: environment.AZURE_SPEECH_KEY?.trim() || null,
    azureSpeechRegion: environment.AZURE_SPEECH_REGION?.trim() || null,
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    timeoutMs: parsePositiveNumber(environment.AZURE_SPEECH_TIMEOUT_MS, 20_000),
    assessmentEnabled: environment.AZURE_SPEECH_ASSESSMENT_ENABLED === "true",
    assessmentTimeoutMs: parsePositiveNumber(environment.AZURE_SPEECH_ASSESSMENT_TIMEOUT_MS, 15_000),
    openRouterTimeoutMs: parsePositiveInteger(environment.TRANSCRIPTION_TIMEOUT_MS, 55_000, 60_000),
    streamMaxDurationMs: parsePositiveInteger(environment.TRANSCRIPTION_STREAM_MAX_DURATION_MS, 180_000, 180_000),
    streamMaxBytes: parsePositiveInteger(environment.TRANSCRIPTION_STREAM_MAX_BYTES, 6 * 1024 * 1024, 6 * 1024 * 1024),
    streamMaxActiveSessions: parsePositiveInteger(environment.TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS, 8, 8),
    streamMaxConcurrentTranscriptions: parsePositiveInteger(environment.TRANSCRIPTION_STREAM_MAX_CONCURRENT_TRANSCRIPTIONS, 4, 4),
    streamMaxQueuedTranscriptions: parsePositiveInteger(environment.TRANSCRIPTION_STREAM_MAX_QUEUED_TRANSCRIPTIONS, 4, 4),
    vadTrailingSilenceMs: parsePositiveInteger(environment.TRANSCRIPTION_VAD_TRAILING_SILENCE_MS, 3_500, 10_000),
    vadFinalizationGraceMs: parsePositiveInteger(environment.TRANSCRIPTION_VAD_FINALIZATION_GRACE_MS, 1_500, 5_000),
    vadAmbientActivityHoldMs: parsePositiveInteger(environment.TRANSCRIPTION_VAD_AMBIENT_HOLD_MS, 8_000, 30_000),
    hedgeAfterMs: parseNonNegativeInteger(environment.TRANSCRIPTION_HEDGE_AFTER_MS, 4_000, 30_000),
  };
}
