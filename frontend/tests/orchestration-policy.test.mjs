import assert from "node:assert/strict";
import test from "node:test";
import { fallbackTurnDecision, normalizeNextTurnDecision } from "../src/lib/interview/orchestration-policy.mjs";

test("the local NEXT fallback does not add a repeated generic acknowledgement", () => {
  assert.deepEqual(fallbackTurnDecision("Tell me about a technical trade-off."), {
    decision: "NEXT",
    followUpQuestion: null,
    nextQuestion: "Tell me about a technical trade-off.",
    acknowledgement: null,
  });
  assert.equal(fallbackTurnDecision(null).acknowledgement, null);
});

test("a valid NEXT response ignores a generic acknowledgement from an older backend", () => {
  assert.deepEqual(normalizeNextTurnDecision({
    decision: "NEXT",
    nextQuestion: "Tell me about a technical trade-off.",
    acknowledgement: "Thanks. Let’s move on to another part of your experience.",
  }, "Fallback question?"), {
    decision: "NEXT",
    followUpQuestion: null,
    nextQuestion: "Tell me about a technical trade-off.",
    acknowledgement: null,
  });
});
