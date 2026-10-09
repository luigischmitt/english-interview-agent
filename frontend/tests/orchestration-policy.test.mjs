import assert from "node:assert/strict";
import test from "node:test";
import { fallbackTurnDecision, normalizeNextTurnDecision, parseTurnDecisionResponse, pickFallbackTransition, pickFixedHandoffTransition } from "../src/lib/interview/orchestration-policy.mjs";

test("the local NEXT fallback adds a neutral, content-free transition", () => {
  assert.deepEqual(fallbackTurnDecision("Tell me about a technical trade-off."), {
    decision: "NEXT",
    followUpQuestion: null,
    nextQuestion: "Tell me about a technical trade-off.",
    acknowledgement: "Thanks for that. Let's move on.",
  });
  assert.equal(fallbackTurnDecision(null).acknowledgement, null);
});

test("fallback transitions rotate and avoid the recent acknowledgements", () => {
  const seen = [];
  for (let index = 0; index < 8; index += 1) seen.push(pickFallbackTransition(seen));
  assert.equal(new Set(seen).size, 8);
  assert.notEqual(pickFallbackTransition(["Thanks for that. Let’s move on."]), "Thanks for that. Let's move on.");
  assert.equal(pickFallbackTransition(seen), seen[0]);
  assert.equal(fallbackTurnDecision("Q?", ["Thanks for that. Let's move on."]).acknowledgement, "Let's move to a different topic.");
});

test("fixed handoff transitions do not duplicate the instant acknowledgement", () => {
  assert.equal(pickFixedHandoffTransition([]), "Let's move to a different topic.");
  assert.notEqual(pickFixedHandoffTransition([]), "Thanks for that. Let's move on.");
});

test("a valid NEXT response keeps the backend bridge", () => {
  assert.deepEqual(normalizeNextTurnDecision({
    decision: "NEXT",
    nextQuestion: "Tell me about a technical trade-off.",
    acknowledgement: "You mentioned Kafka, so I'd like to look at another side of your work.",
  }, "Fallback question?"), {
    decision: "NEXT",
    followUpQuestion: null,
    nextQuestion: "Tell me about a technical trade-off.",
    acknowledgement: "You mentioned Kafka, so I'd like to look at another side of your work.",
  });
});

test("a NEXT response without a question uses the fixed question with a neutral transition", () => {
  assert.deepEqual(normalizeNextTurnDecision({ nextQuestion: null, acknowledgement: null }, "Fallback question?", ["Thanks for that. Let's move on."]), {
    decision: "NEXT",
    followUpQuestion: null,
    nextQuestion: "Fallback question?",
    acknowledgement: "Let's move to a different topic.",
  });
});

test("the response parser accepts bridges up to 220 characters for NEXT and FOLLOW_UP", () => {
  const bridge = `You mentioned Kafka, ${"so ".repeat(80)}`.trim().slice(0, 220).trimEnd();
  assert.equal(bridge.length <= 220, true);
  const next = parseTurnDecisionResponse({ decision: "NEXT", followUpQuestion: null, nextQuestion: "How do you monitor a service?", acknowledgement: bridge }, { followUpUsed: false, fallbackQuestion: "Q?" });
  assert.deepEqual(next, { decision: "NEXT", followUpQuestion: null, nextQuestion: "How do you monitor a service?", acknowledgement: bridge });
  const followUp = parseTurnDecisionResponse({ decision: "FOLLOW_UP", followUpQuestion: "Why Kafka?", nextQuestion: null, acknowledgement: "Got it." }, { followUpUsed: false, fallbackQuestion: "Q?" });
  assert.equal(followUp?.acknowledgement, "Got it.");
});

test("the response parser rejects a bridge over 220 characters and malformed shapes", () => {
  const options = { followUpUsed: false, fallbackQuestion: "Q?" };
  assert.equal(parseTurnDecisionResponse({ decision: "NEXT", followUpQuestion: null, nextQuestion: "How do you monitor a service?", acknowledgement: "x".repeat(221) }, options), null);
  assert.equal(parseTurnDecisionResponse({ decision: "NEXT", followUpQuestion: null, nextQuestion: "No question mark", acknowledgement: null }, options), null);
  assert.equal(parseTurnDecisionResponse({ decision: "FOLLOW_UP", followUpQuestion: "Why Kafka?", nextQuestion: null, acknowledgement: null }, { ...options, followUpUsed: true }), null);
  assert.equal(parseTurnDecisionResponse(null, options), null);
});

test("the response parser drops a repeated recent bridge but keeps the question", () => {
  const result = parseTurnDecisionResponse({ decision: "NEXT", followUpQuestion: null, nextQuestion: "How do you monitor a service?", acknowledgement: "Got it, let's switch gears." }, { followUpUsed: false, fallbackQuestion: "Q?", recentAcknowledgements: ["Got it. Let’s switch gears!"] });
  assert.equal(result?.nextQuestion, "How do you monitor a service?");
  assert.equal(result?.acknowledgement, null);
});

test("earlier answers keep their opening (where projects are described) and their ending within 500 characters", async () => {
  const { condensePreviousAnswer } = await import("../src/lib/interview/previous-answers.mjs");
  const answer = `I built a payments reconciliation service in Node.js and Postgres. ${"filler words ".repeat(80)}In the end we cut mismatches by half.`;
  const condensed = condensePreviousAnswer(answer);
  assert.ok(condensed.length <= 500 && condensed.includes(" … "));
  assert.ok(condensed.startsWith("I built a payments reconciliation service"));
  assert.ok(condensed.endsWith("we cut mismatches by half."));
  assert.equal(condensePreviousAnswer("Short answer."), "Short answer.");
});
