export type TranscriptionConfig = {
  azureSpeechKey: string | null;
  azureSpeechRegion: string | null;
  openRouterApiKey: string | null;
  timeoutMs: number;
  assessmentEnabled: boolean;
  assessmentTimeoutMs: number;
  streamMaxDurationMs: number;
  streamMaxBytes: number;
  streamMaxActiveSessions: number;
  streamMaxQueueBytes: number;
};

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Transcription timeout must be a positive number.");
  }

  return parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = parsePositiveNumber(value, fallback);
  if (!Number.isInteger(parsed)) throw new Error("Transcription stream limits must be positive integers.");
  return parsed;
}

export function loadTranscriptionConfig(environment = process.env): TranscriptionConfig {
  return {
    azureSpeechKey: environment.AZURE_SPEECH_KEY?.trim() || null,
    azureSpeechRegion: environment.AZURE_SPEECH_REGION?.trim() || null,
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    timeoutMs: parsePositiveNumber(environment.AZURE_SPEECH_TIMEOUT_MS, 20_000),
    assessmentEnabled: environment.AZURE_SPEECH_ASSESSMENT_ENABLED === "true",
    assessmentTimeoutMs: parsePositiveNumber(environment.AZURE_SPEECH_ASSESSMENT_TIMEOUT_MS, 8_000),
    streamMaxDurationMs: parsePositiveInteger(environment.TRANSCRIPTION_STREAM_MAX_DURATION_MS, 180_000),
    streamMaxBytes: parsePositiveInteger(environment.TRANSCRIPTION_STREAM_MAX_BYTES, 6 * 1024 * 1024),
    streamMaxActiveSessions: parsePositiveInteger(environment.TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS, 8),
    streamMaxQueueBytes: parsePositiveInteger(environment.TRANSCRIPTION_STREAM_MAX_QUEUE_BYTES, 512 * 1024),
  };
}
