import { describe, expect, it } from "vitest";
import { defaultInterviewTurnAnalysisTimeoutMs, loadThinkingConfig, maxInterviewTurnAnalysisTimeoutMs } from "../src/thinking/config.js";

describe("speculative handoff config", () => {
  it("defaults off and accepts only off or on", () => {
    expect(loadThinkingConfig({}).speculativeHandoffEnabled).toBe(false);
    expect(loadThinkingConfig({ INTERVIEW_SPECULATIVE_HANDOFF: "on" }).speculativeHandoffEnabled).toBe(true);
    expect(() => loadThinkingConfig({ INTERVIEW_SPECULATIVE_HANDOFF: "true" })).toThrow("off or on");
  });
});

describe("per-answer report analysis timeout", () => {
  it("allows slow background analyses up to 22 seconds", () => {
    expect(defaultInterviewTurnAnalysisTimeoutMs).toBe(22_000);
    expect(maxInterviewTurnAnalysisTimeoutMs).toBe(22_000);
  });
});
