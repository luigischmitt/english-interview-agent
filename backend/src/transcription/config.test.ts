import { describe, expect, it } from "vitest";
import { loadTranscriptionConfig } from "./config.js";

describe("optional Azure assessment configuration", () => {
  it("is off by default and uses a bounded positive timeout", () => {
    const config = loadTranscriptionConfig({});
    expect(config.assessmentEnabled).toBe(false);
    expect(config.assessmentTimeoutMs).toBe(8_000);
    expect(config.streamMaxDurationMs).toBe(180_000);
    expect(config.streamMaxBytes).toBe(6 * 1024 * 1024);
    expect(config.streamMaxActiveSessions).toBe(8);
    expect(config.streamMaxQueueBytes).toBe(512 * 1024);
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
      TRANSCRIPTION_STREAM_MAX_QUEUE_BYTES: "256000",
    });
    expect(config).toMatchObject({ streamMaxDurationMs: 90_000, streamMaxBytes: 3_000_000, streamMaxActiveSessions: 4, streamMaxQueueBytes: 256_000 });
    expect(() => loadTranscriptionConfig({ TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS: "1.5" })).toThrow("positive integers");
  });
});
