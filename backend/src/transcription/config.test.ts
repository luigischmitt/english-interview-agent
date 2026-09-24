import { describe, expect, it } from "vitest";
import { loadTranscriptionConfig } from "./config.js";

describe("optional Azure assessment configuration", () => {
  it("is off by default and uses a bounded positive timeout", () => {
    const config = loadTranscriptionConfig({});
    expect(config.assessmentEnabled).toBe(false);
    expect(config.assessmentTimeoutMs).toBe(8_000);
  });

  it("enables assessment only on the explicit true toggle", () => {
    expect(loadTranscriptionConfig({ AZURE_SPEECH_ASSESSMENT_ENABLED: "true" }).assessmentEnabled).toBe(true);
    expect(loadTranscriptionConfig({ AZURE_SPEECH_ASSESSMENT_ENABLED: "1" }).assessmentEnabled).toBe(false);
  });
});
