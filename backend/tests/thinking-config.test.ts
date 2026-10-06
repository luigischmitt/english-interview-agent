import { describe, expect, it } from "vitest";
import { loadThinkingConfig } from "../src/thinking/config.js";

describe("speculative handoff config", () => {
  it("defaults off and accepts only off or on", () => {
    expect(loadThinkingConfig({}).speculativeHandoffEnabled).toBe(false);
    expect(loadThinkingConfig({ INTERVIEW_SPECULATIVE_HANDOFF: "on" }).speculativeHandoffEnabled).toBe(true);
    expect(() => loadThinkingConfig({ INTERVIEW_SPECULATIVE_HANDOFF: "true" })).toThrow("off or on");
  });
});
