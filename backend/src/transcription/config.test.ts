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
});
