import { describe, expect, it } from "vitest";
import { loadTranscriptionConfig } from "./config.js";

describe("optional Azure assessment configuration", () => {
  it("is off by default and uses a bounded positive timeout", () => {
    const config = loadTranscriptionConfig({});
    expect(config.assessmentEnabled).toBe(false);
    expect(config.assessmentTimeoutMs).toBe(15_000);
    expect(config.streamMaxDurationMs).toBe(180_000);
    expect(config.streamMaxBytes).toBe(6 * 1024 * 1024);
    expect(config.streamMaxActiveSessions).toBe(20);
    expect(config.openRouterTimeoutMs).toBe(55_000);
    expect(config.streamMaxConcurrentTranscriptions).toBe(4);
    expect(config.streamMaxQueuedTranscriptions).toBe(4);
    expect(config.vadTrailingSilenceMs).toBe(3_500);
    expect(config.vadFinalizationGraceMs).toBe(1_500);
    expect(config.vadAmbientActivityHoldMs).toBe(8_000);
    expect(config.hedgeAfterMs).toBe(4_000);
  });

  it("accepts a hedge delay from 0 (disabled) to 30000 and rejects anything else", () => {
    expect(loadTranscriptionConfig({ TRANSCRIPTION_HEDGE_AFTER_MS: "0" }).hedgeAfterMs).toBe(0);
    expect(loadTranscriptionConfig({ TRANSCRIPTION_HEDGE_AFTER_MS: "30000" }).hedgeAfterMs).toBe(30_000);
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_HEDGE_AFTER_MS: "30001" })).toThrow("0 to 30000");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_HEDGE_AFTER_MS: "-1" })).toThrow("0 to 30000");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_HEDGE_AFTER_MS: "1.5" })).toThrow("0 to 30000");
  });

  it("enables assessment only on the explicit true toggle", () => {
    expect(loadTranscriptionConfig({ AZURE_SPEECH_ASSESSMENT_ENABLED: "true" }).assessmentEnabled).toBe(true);
    expect(loadTranscriptionConfig({ AZURE_SPEECH_ASSESSMENT_ENABLED: "1" }).assessmentEnabled).toBe(false);
  });

  it("allows bounded stream limits to be overridden with positive integers", () => {
    const config = loadTranscriptionConfig({
      TRANSCRIPTION_STREAM_MAX_DURATION_MS: "90000",
      TRANSCRIPTION_STREAM_MAX_BYTES: "3000000",
      TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS: "4",
      TRANSCRIPTION_STREAM_MAX_CONCURRENT_TRANSCRIPTIONS: "2",
      TRANSCRIPTION_STREAM_MAX_QUEUED_TRANSCRIPTIONS: "3",
      TRANSCRIPTION_TIMEOUT_MS: "45000",
    });
    expect(config).toMatchObject({ streamMaxDurationMs: 90_000, streamMaxBytes: 3_000_000, streamMaxActiveSessions: 4, streamMaxConcurrentTranscriptions: 2, streamMaxQueuedTranscriptions: 3, openRouterTimeoutMs: 45_000 });
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS: "1.5" })).toThrow("positive integers");
    expect(loadTranscriptionConfig({ TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS: "20" }).streamMaxActiveSessions).toBe(20);
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS: "21" })).toThrow("no greater than 20");
    // At the configured 20-session ceiling, PCM buffers plus one WAV copy per finalizing session stay bounded near 240 MiB.
    expect(20 * 6 * 1024 * 1024 * 2).toBe(240 * 1024 * 1024);
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_STREAM_MAX_CONCURRENT_TRANSCRIPTIONS: "5" })).toThrow("no greater than 4");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_STREAM_MAX_BYTES: "7000000" })).toThrow("no greater than 6291456");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_TIMEOUT_MS: "61000" })).toThrow("no greater than 60000");
  });

  it("allows bounded VAD grace periods to be tuned without changing the 180 second cap", () => {
    const config = loadTranscriptionConfig({
      TRANSCRIPTION_VAD_TRAILING_SILENCE_MS: "5000",
      TRANSCRIPTION_VAD_FINALIZATION_GRACE_MS: "2500",
      TRANSCRIPTION_VAD_AMBIENT_HOLD_MS: "10000",
    });
    expect(config).toMatchObject({ vadTrailingSilenceMs: 5_000, vadFinalizationGraceMs: 2_500, vadAmbientActivityHoldMs: 10_000, streamMaxDurationMs: 180_000 });
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_VAD_TRAILING_SILENCE_MS: "12000" })).toThrow("no greater than 10000");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_VAD_FINALIZATION_GRACE_MS: "6000" })).toThrow("no greater than 5000");
  });
});

describe("incremental Whisper configuration", () => {
  it("defaults to incremental Whisper with the documented grace, prepare and pause timings", () => {
    const config = loadTranscriptionConfig({});
    expect(config).toMatchObject({
      transcriptionProvider: "whisper-incremental", legacyTranscriptionProvider: null,
      answerGraceMs: 3_500, incompleteGraceMs: 6_000, prepareAfterMs: 1_200, maxPrepares: 3, pauseMs: 800,
    });
    expect(config).toMatchObject({ semanticCheckAfterMs: 0, semanticCompleteMinSilenceMs: 900, maxSemanticChecks: 2, tailHedgeAfterMs: 1_500 });
    expect(loadTranscriptionConfig({ TRANSCRIPTION_SEMANTIC_COMPLETE_MIN_SILENCE_MS: "1200", TRANSCRIPTION_TAIL_HEDGE_AFTER_MS: "0" })).toMatchObject({ semanticCompleteMinSilenceMs: 1_200, tailHedgeAfterMs: 0 });
    expect(loadTranscriptionConfig({ TRANSCRIPTION_PREPARE_AFTER_MS: "0" }).prepareAfterMs).toBe(0);
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_MAX_PREPARES: "4" })).toThrow("0 to 3");
  });

  it("parses bounded timings", () => {
    expect(loadTranscriptionConfig({ TRANSCRIPTION_ANSWER_GRACE_MS: "500", TRANSCRIPTION_PAUSE_MS: "300" })).toMatchObject({ answerGraceMs: 500, pauseMs: 300 });
    expect(loadTranscriptionConfig({ TRANSCRIPTION_PAUSE_MS: "3000" }).pauseMs).toBe(3_000);
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_ANSWER_GRACE_MS: "499" })).toThrow("500 to 10000");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_ANSWER_GRACE_MS: "10001" })).toThrow("500 to 10000");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_INCOMPLETE_GRACE_MS: "15001" })).toThrow("500 to 15000");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_PAUSE_MS: "299" })).toThrow("300 to 3000");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_PAUSE_MS: "3001" })).toThrow("300 to 3000");
  });

  it("enables the semantic end check by default and validates its timeout", () => {
    expect(loadTranscriptionConfig({})).toMatchObject({ semanticEndEnabled: true, semanticEndTimeoutMs: 1_500 });
    expect(loadTranscriptionConfig({ TRANSCRIPTION_SEMANTIC_END_ENABLED: "false", TRANSCRIPTION_SEMANTIC_END_TIMEOUT_MS: "800" })).toMatchObject({ semanticEndEnabled: false, semanticEndTimeoutMs: 800 });
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_SEMANTIC_END_TIMEOUT_MS: "100" })).toThrow("200 to 5000");
  });

  it("accepts whisper-incremental and maps the retired provider values to it, flagging them for a startup warning", () => {
    expect(loadTranscriptionConfig({ TRANSCRIPTION_PROVIDER: " Whisper-Incremental " })).toMatchObject({ transcriptionProvider: "whisper-incremental", legacyTranscriptionProvider: null });
    expect(loadTranscriptionConfig({ TRANSCRIPTION_PROVIDER: "cartesia" })).toMatchObject({ transcriptionProvider: "whisper-incremental", legacyTranscriptionProvider: "cartesia" });
    expect(loadTranscriptionConfig({ TRANSCRIPTION_PROVIDER: "whisper" })).toMatchObject({ transcriptionProvider: "whisper-incremental", legacyTranscriptionProvider: "whisper" });
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_PROVIDER: "other" })).toThrow("whisper-incremental");
  });
});
