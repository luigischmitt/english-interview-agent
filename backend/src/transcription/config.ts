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
  /** Always incremental Whisper; kept as a field so logs and callers can state the active engine. */
  transcriptionProvider: "whisper-incremental";
  /** Set when `TRANSCRIPTION_PROVIDER` held a retired value that was mapped to `whisper-incremental` (startup warning); null otherwise. */
  legacyTranscriptionProvider: "whisper" | "cartesia" | null;
  pauseMs: number;
  answerGraceMs: number;
  incompleteGraceMs: number;
  prepareAfterMs: number;
  maxPrepares: number;
  semanticEndEnabled: boolean;
  semanticEndTimeoutMs: number;
  /** Send a vocabulary/context `prompt` with every Whisper request. `TRANSCRIPTION_WHISPER_PROMPT=off` disables it. */
  whisperPromptEnabled: boolean;
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

function parseIntegerInRange(value: string | undefined, fallback: number, minimum: number, maximum: number, label: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${label} must be an integer from ${minimum} to ${maximum}.`);
  return parsed;
}

/**
 * `whisper-incremental` is the only engine. `cartesia` and `whisper` were valid before and may still be set in a deployed
 * environment, so they are accepted and mapped to `whisper-incremental` (the caller logs a one-time warning).
 */
function parseTranscriptionProvider(value: string | undefined): { provider: "whisper-incremental"; legacy: "whisper" | "cartesia" | null } {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "whisper-incremental") return { provider: "whisper-incremental", legacy: null };
  if (normalized === "cartesia" || normalized === "whisper") return { provider: "whisper-incremental", legacy: normalized };
  throw new Error("TRANSCRIPTION_PROVIDER must be whisper-incremental.");
}

export function loadTranscriptionConfig(environment = process.env): TranscriptionConfig {
  const provider = parseTranscriptionProvider(environment.TRANSCRIPTION_PROVIDER);
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
    transcriptionProvider: provider.provider,
    legacyTranscriptionProvider: provider.legacy,
    pauseMs: parseIntegerInRange(environment.TRANSCRIPTION_PAUSE_MS, 800, 300, 3_000, "Transcription pause"),
    answerGraceMs: parseIntegerInRange(environment.TRANSCRIPTION_ANSWER_GRACE_MS, 3_500, 500, 10_000, "Answer grace"),
    incompleteGraceMs: parseIntegerInRange(environment.TRANSCRIPTION_INCOMPLETE_GRACE_MS, 6_000, 500, 15_000, "Incomplete-turn grace"),
    prepareAfterMs: parseIntegerInRange(environment.TRANSCRIPTION_PREPARE_AFTER_MS, 1_200, 0, 10_000, "Prepare delay"),
    maxPrepares: parseIntegerInRange(environment.TRANSCRIPTION_MAX_PREPARES, 2, 0, 5, "Max prepares"),
    semanticEndEnabled: environment.TRANSCRIPTION_SEMANTIC_END_ENABLED?.trim().toLowerCase() !== "false",
    semanticEndTimeoutMs: parseIntegerInRange(environment.TRANSCRIPTION_SEMANTIC_END_TIMEOUT_MS, 1_500, 200, 5_000, "Semantic end timeout"),
    whisperPromptEnabled: environment.TRANSCRIPTION_WHISPER_PROMPT?.trim().toLowerCase() !== "off",
  };
}
