import { describe, expect, it } from "vitest";
import { loadTranscriptionConfig } from "./config.js";

describe("optional Azure assessment configuration", () => {
  it("is off by default and uses a bounded positive timeout", () => {
    const config = loadTranscriptionConfig({});
    expect(config.assessmentEnabled).toBe(false);
    expect(config.assessmentTimeoutMs).toBe(15_000);
    expect(config.streamMaxDurationMs).toBe(180_000);
    expect(config.streamMaxBytes).toBe(6 * 1024 * 1024);
    expect(config.streamMaxActiveSessions).toBe(8);
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

describe("optional Cartesia Ink-2 configuration", () => {
  it("defaults to Whisper with a 2 second answer grace", () => {
    const config = loadTranscriptionConfig({});
    expect(config.transcriptionProvider).toBe("whisper");
    expect(config.cartesiaApiKey).toBeNull();
    expect(config.cartesiaAnswerGraceMs).toBe(3_500);
    expect(config.cartesiaIncompleteGraceMs).toBe(6_000);
    expect(config.cartesiaTurnEndTimeoutMs).toBeNull();
  });

  it("parses the provider, key and bounded timings", () => {
    const config = loadTranscriptionConfig({
      TRANSCRIPTION_PROVIDER: "Cartesia", CARTESIA_API_KEY: " sentinel ",
      TRANSCRIPTION_CARTESIA_ANSWER_GRACE_MS: "500", CARTESIA_TURN_END_TIMEOUT_MS: "11200",
    });
    expect(config).toMatchObject({ transcriptionProvider: "cartesia", cartesiaApiKey: "sentinel", cartesiaAnswerGraceMs: 500, cartesiaTurnEndTimeoutMs: 11_200 });
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_PROVIDER: "other" })).toThrow("whisper or cartesia");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_CARTESIA_ANSWER_GRACE_MS: "499" })).toThrow("500 to 10000");
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_CARTESIA_ANSWER_GRACE_MS: "10001" })).toThrow("500 to 10000");
    expect(() => loadTranscriptionConfig({ CARTESIA_TURN_END_TIMEOUT_MS: "639" })).toThrow("640 to 11200");
    expect(() => loadTranscriptionConfig({ CARTESIA_TURN_END_TIMEOUT_MS: "11201" })).toThrow("640 to 11200");
  });
});
