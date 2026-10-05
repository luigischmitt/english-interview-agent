import assert from "node:assert/strict";
import test from "node:test";

import { assessmentContextKey, canClarifyAgain, composeClarificationTurn, isClarificationDecision, maxClarificationsPerQuestion, moveOnBridge, planTurnAfterDecision, repeatSpeechSpeed } from "../src/lib/interview/clarification-policy.mjs";
import { parseTurnDecisionResponse, repeatTurnDecision } from "../src/lib/interview/orchestration-policy.mjs";

const question = "Tell me about a difficult technical decision you made.";

test("composes the spoken turn for each clarification outcome", () => {
  assert.deepEqual(composeClarificationTurn({ decision: "REPEAT", question }), { acknowledgement: "Sure.", question, base: question, speed: repeatSpeechSpeed });
  assert.equal(repeatSpeechSpeed, 0.9);
  const rephrased = composeClarificationTurn({ decision: "REPHRASE", clarificationText: "What was a hard technical choice you made?", question });
  assert.deepEqual(rephrased, { acknowledgement: "Let me put it another way.", question: "What was a hard technical choice you made?", base: "What was a hard technical choice you made?", speed: 1 });
  const defined = composeClarificationTurn({ decision: "DEFINE", clarificationText: "Scalability means how well a system handles more users or data", question });
  assert.deepEqual(defined, { acknowledgement: "Scalability means how well a system handles more users or data.", question: `So, tell me about a difficult technical decision you made.`, base: question, speed: 1 });
});

test("an unusable rephrase or definition degrades to a plain repeat", () => {
  for (const clarificationText of [null, "", "Not a question", `${"x".repeat(230)}?`]) {
    assert.equal(composeClarificationTurn({ decision: "REPHRASE", clarificationText, question }).acknowledgement, "Sure.");
  }
  for (const clarificationText of [null, "Is it this?", "x".repeat(170)]) {
    assert.equal(composeClarificationTurn({ decision: "DEFINE", clarificationText, question }).acknowledgement, "Sure.");
  }
});

test("a clarification is never an answer and does not touch the report", () => {
  const plan = planTurnAfterDecision({ decision: repeatTurnDecision("detector"), clarificationsSoFar: 0, nextQuestion: "Next?" });
  assert.equal(plan.countsAsAnswer, false);
  assert.equal(plan.clarify, true);
  assert.equal(plan.clarificationsAfter, 1);
  const answer = { decision: "FOLLOW_UP", followUpQuestion: "Why Postgres?", nextQuestion: null, acknowledgement: null };
  const answerPlan = planTurnAfterDecision({ decision: answer, clarificationsSoFar: 1, nextQuestion: "Next?" });
  assert.equal(answerPlan.countsAsAnswer, true);
  assert.equal(answerPlan.clarify, false);
  assert.equal(answerPlan.turn, answer);
});

test("allows two clarifications per question and moves on at the third", () => {
  assert.equal(maxClarificationsPerQuestion, 2);
  assert.equal(canClarifyAgain(0), true);
  assert.equal(canClarifyAgain(1), true);
  assert.equal(canClarifyAgain(2), false);
  const third = planTurnAfterDecision({ decision: { decision: "REPHRASE", clarificationText: "x?" }, clarificationsSoFar: 2, nextQuestion: "How do you monitor a service?" });
  assert.equal(third.clarify, false);
  assert.equal(third.countsAsAnswer, false);
  assert.deepEqual(third.turn, { decision: "NEXT", followUpQuestion: null, nextQuestion: "How do you monitor a service?", acknowledgement: moveOnBridge });
  assert.equal(moveOnBridge, "Let's move on to the next one.");
});

test("recognizes clarification decisions", () => {
  assert.equal(isClarificationDecision({ decision: "DEFINE" }), true);
  assert.equal(isClarificationDecision({ decision: "NEXT" }), false);
  assert.equal(isClarificationDecision(null), false);
});

test("assessments of a clarification window are keyed by question and round", () => {
  assert.equal(assessmentContextKey({ sequenceNumber: 3, round: 1 }), "3:1");
  assert.equal(assessmentContextKey({ sequenceNumber: 3 }), "3:0");
});

test("parses clarification decisions from the backend", () => {
  const options = { followUpUsed: false, fallbackQuestion: "Next?" };
  const base = { followUpQuestion: null, nextQuestion: null, anchor: null, acknowledgement: null };
  assert.deepEqual(parseTurnDecisionResponse({ ...base, decision: "REPEAT", clarificationText: null, clarification: "detector" }, options), repeatTurnDecision("detector"));
  assert.deepEqual(parseTurnDecisionResponse({ ...base, decision: "REPHRASE", clarificationText: " What was a hard choice you made? ", clarification: "model" }, options), { decision: "REPHRASE", followUpQuestion: null, nextQuestion: null, acknowledgement: null, clarificationText: "What was a hard choice you made?", clarification: "model" });
  assert.equal(parseTurnDecisionResponse({ ...base, decision: "DEFINE", clarificationText: "Latency is the delay before a response arrives." }, options)?.decision, "DEFINE");
  assert.equal(parseTurnDecisionResponse({ ...base, decision: "REPHRASE", clarificationText: "Not a question" }, options), null);
  assert.equal(parseTurnDecisionResponse({ ...base, decision: "DEFINE", clarificationText: "Is this a question?" }, options), null);
  assert.equal(parseTurnDecisionResponse({ ...base, nextQuestion: "Other question?", decision: "REPEAT", clarificationText: null }, options), null);
});

test("the speech request carries the speed only when it differs from the default", async () => {
  const { clearRetainedSpeechBlobs, prewarmInterviewerSpeech } = await import("../src/lib/interview/speech-playback.mjs");
  const bodies = [];
  const fetcher = async (_url, init) => { bodies.push(JSON.parse(init.body)); return new Response(new Blob(["audio"])); };
  clearRetainedSpeechBlobs();
  await prewarmInterviewerSpeech(["Sure. Tell me about your last project."], { endpoint: "http://speech.test", fetcher, speed: 0.9, retainMs: 0 }).promise;
  await prewarmInterviewerSpeech(["Thanks. How do you monitor a service?"], { endpoint: "http://speech.test", fetcher, retainMs: 0 }).promise;
  clearRetainedSpeechBlobs();
  assert.deepEqual(bodies[0], { text: "Sure. Tell me about your last project.", speed: 0.9 });
  assert.deepEqual(bodies[1], { text: "Thanks. How do you monitor a service?" });
});
