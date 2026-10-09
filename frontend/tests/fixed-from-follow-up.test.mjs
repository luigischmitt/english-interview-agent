import assert from "node:assert/strict";
import test from "node:test";
import { canUseFixedDecisionFromFollowUp, resolveFixedFromFollowUp } from "../src/lib/interview/fixed-from-follow-up.mjs";
import { createNextTurnPreparationRegistry } from "../src/lib/interview/next-turn-preparation.mjs";
import { canUseCurrentEpochCandidate, discardCoveredFollowUps, finalEpochCandidateStatus, recordCandidateStatus } from "../src/lib/interview/speculative-epoch.mjs";

const bank = (id) => ({ id, prompt: `Original ${id}` });
const remaining = [bank("bank-1"), bank("bank-2"), bank("job-1"), bank("resume-1")];
const prep = (overrides = {}) => ({
  turnId: "t", revision: 1, speechEpoch: 0, transcript: "I used Kafka.", anchor: "Kafka",
  decision: { decision: "FOLLOW_UP" },
  nextPlannedQuestionId: "bank-1", nextPlannedQuestionPrompt: "Adapted bank-1", originalFixedPrompt: "Original bank-1",
  adaptedFixedQuestion: true, skippedPlannedQuestionIds: [], ...overrides,
});
const ctx = { currentTurnId: "t", currentSpeechEpoch: 0, featureEnabled: true };

test("a covered FOLLOW_UP+DEEPEN preparation lends its adapted fixed prompt as NEXT", () => {
  const value = prep();
  assert.equal(canUseCurrentEpochCandidate({ value, finalTranscript: "I used Kafka and more.", ...ctx, compatibility: "COVERED" }), false);
  assert.equal(canUseFixedDecisionFromFollowUp({ value, ...ctx }), true);
  const fixed = resolveFixedFromFollowUp({ value, remaining, adaptedAudioReady: true });
  assert.equal(fixed.prompt, "Adapted bank-1");
  assert.equal(fixed.question.id, "bank-1");
  assert.equal(fixed.usedAdaptedPrompt, true);
});

test("adapted audio not ready falls back to the original prompt", () => {
  const fixed = resolveFixedFromFollowUp({ value: prep(), remaining, adaptedAudioReady: false });
  assert.equal(fixed.prompt, "Original bank-1");
  assert.equal(fixed.usedAdaptedPrompt, false);
});

test("NONE or missing status: the fixed decision is lent, the follow-up is not", () => {
  const value = prep();
  for (const compatibility of ["NONE", undefined]) {
    assert.equal(canUseCurrentEpochCandidate({ value, finalTranscript: "different", ...ctx, compatibility }), false);
    assert.equal(canUseFixedDecisionFromFollowUp({ value, ...ctx }), true);
  }
});

test("a stale-turn, future-epoch, disabled or fixed-less preparation is never used", () => {
  assert.equal(canUseFixedDecisionFromFollowUp({ value: prep({ turnId: "old" }), ...ctx }), false);
  assert.equal(canUseFixedDecisionFromFollowUp({ value: prep({ speechEpoch: 3 }), ...ctx }), false);
  assert.equal(canUseFixedDecisionFromFollowUp({ value: prep(), ...ctx, featureEnabled: false }), false);
  assert.equal(canUseFixedDecisionFromFollowUp({ value: prep({ nextPlannedQuestionId: null }), ...ctx }), false);
  assert.equal(canUseFixedDecisionFromFollowUp({ value: prep({ decision: { decision: "NEXT" } }), ...ctx }), false);
});

test("skipped job questions are never applied, bank skips are", () => {
  const fixed = resolveFixedFromFollowUp({ value: prep({ nextPlannedQuestionId: "resume-1", nextPlannedQuestionPrompt: null, adaptedFixedQuestion: false, skippedPlannedQuestionIds: ["bank-1", "job-1", "gone"] }), remaining, adaptedAudioReady: true });
  assert.deepEqual(fixed.skippedQuestionIds, ["bank-1"]);
  assert.equal(fixed.prompt, "Original resume-1");
  assert.equal(resolveFixedFromFollowUp({ value: prep({ nextPlannedQuestionId: "gone" }), remaining, adaptedAudioReady: true }), null);
});

test("registry: covered FOLLOW_UPs stay retrievable (newest only, audio released) and are claimed via the fallback", async () => {
  const registry = createNextTurnPreparationRegistry();
  const cancelled = [];
  for (const revision of [1, 2]) {
    await registry.prepare({ transcript: `a${revision}`, preserveReady: true, run: async () => prep({ revision, transcript: `a${revision}`, cancelSpeech: () => cancelled.push(revision), nextPlannedQuestionPrompt: `Adapted r${revision}` }) }).promise;
  }
  const statuses = new Map();
  const latest = new Map();
  recordCandidateStatus(statuses, latest, { speechEpoch: 0, revision: 2, status: "COVERED" }, 0);
  assert.equal(discardCoveredFollowUps(registry, { revision: 2, status: "COVERED" }), 2);
  assert.deepEqual(cancelled.sort(), [1, 2]);
  assert.deepEqual(registry.readyValues().map((value) => value.revision), [2]);
  const entry = registry.takeAnyReady({
    accept: (value) => canUseCurrentEpochCandidate({ value, finalTranscript: "other", ...ctx, compatibility: finalEpochCandidateStatus(statuses, latest, value.revision, 0) }),
    fallbackAccept: (value) => canUseFixedDecisionFromFollowUp({ value, ...ctx }),
  });
  assert.equal(entry.viaFallback, true);
  assert.equal(entry.value.nextPlannedQuestionPrompt, "Adapted r2");
});

test("registry: an OPEN follow-up wins over a newer fallback-only preparation", async () => {
  const registry = createNextTurnPreparationRegistry();
  await registry.prepare({ transcript: "a1", preserveReady: true, run: async () => prep({ revision: 1 }) }).promise;
  await registry.prepare({ transcript: "a2", preserveReady: true, run: async () => prep({ revision: 2 }) }).promise;
  const entry = registry.takeAnyReady({ accept: (value) => value.revision === 1, fallbackAccept: () => true });
  assert.equal(entry.viaFallback, false);
  assert.equal(entry.value.revision, 1);
});

test("a newer ready analysis or a committed skip blocks lending an older follow-up's fixed decision", () => {
  const value = { turnId: "t1", revision: 2, speechEpoch: 0, decision: { decision: "FOLLOW_UP" }, nextPlannedQuestionId: "q2" };
  const base = { value, currentTurnId: "t1", currentSpeechEpoch: 0, featureEnabled: true };
  assert.equal(canUseFixedDecisionFromFollowUp(base), true);
  assert.equal(canUseFixedDecisionFromFollowUp({ ...base, newestReadyRevision: 3 }), false);
  assert.equal(canUseFixedDecisionFromFollowUp({ ...base, committedSkippedIds: new Set(["q2"]) }), false);
});

test("a retired follow-up never plays, even when the final transcript is identical", () => {
  const value = { turnId: "t1", revision: 5, speechEpoch: 0, transcript: "Same answer.", decision: { decision: "FOLLOW_UP" }, followUpReleased: true };
  assert.equal(canUseCurrentEpochCandidate({ value, finalTranscript: "Same answer.", currentTurnId: "t1", currentSpeechEpoch: 1, featureEnabled: true }), false);
  assert.equal(canUseCurrentEpochCandidate({ value: { ...value, followUpReleased: false }, finalTranscript: "Same answer.", currentTurnId: "t1", currentSpeechEpoch: 1, featureEnabled: true }), true);
});
