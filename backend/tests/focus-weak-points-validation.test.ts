import { describe, expect, it } from "vitest";
import { parseOrchestrationInput } from "../src/controllers/orchestration-controller.js";
import { isValidFocusWeakPoints } from "../src/controllers/speculative-turn-controller.js";

const baseRequest = {
  currentQuestion: "How would you improve an API?", transcript: "I add retries.", nextFixedQuestion: null,
  followUpUsed: false, roleContext: { targetRole: "Backend Engineer" },
};

describe("focused weak-point request validation", () => {
  it("accepts an optional bounded summary and leaves it absent by default", () => {
    expect(parseOrchestrationInput(baseRequest)).not.toHaveProperty("focusWeakPoints");
    expect(parseOrchestrationInput({ ...baseRequest, focusWeakPoints: "Grammar: past tense" })).toMatchObject({ focusWeakPoints: "Grammar: past tense" });
    expect(isValidFocusWeakPoints(undefined)).toBe(true);
    expect(isValidFocusWeakPoints("x".repeat(1200))).toBe(true);
    expect(isValidFocusWeakPoints("x".repeat(1201))).toBe(false);
  });

  it("rejects malformed summaries", () => {
    expect(parseOrchestrationInput({ ...baseRequest, focusWeakPoints: " " })).toBeNull();
    expect(parseOrchestrationInput({ ...baseRequest, focusWeakPoints: "x".repeat(1201) })).toBeNull();
    expect(isValidFocusWeakPoints(42)).toBe(false);
  });
});
