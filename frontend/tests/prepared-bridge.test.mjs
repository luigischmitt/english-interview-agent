import assert from "node:assert/strict";
import test from "node:test";
import { bridgeForSelection, createPreparedBridgeRegistry, MAX_POST_FOLLOW_UP_ANALYSES } from "../src/lib/interview/prepared-bridge.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const prewarmer = () => {
  const calls = [];
  const prewarm = (utterance) => {
    const call = { utterance, cancelled: false };
    calls.push(call);
    return { firstChunkReady: Promise.resolve(true), cancel: () => { call.cancelled = true; } };
  };
  return { calls, prewarm };
};
const compose = (bridge) => `${bridge} How did you monitor it?`;
const offer = (registry, overrides = {}) => registry.offer({ turnId: "t1", revision: 2, speechEpoch: 1, bridge: "You mentioned retries.", prompt: "How did you monitor it?", utterance: compose("You mentioned retries."), ...overrides });

test("a bridge is used only for the planned question it was validated for", () => {
  assert.equal(bridgeForSelection({ bridge: " You mentioned retries. ", bridgeFor: "How did you monitor it?", originalPrompt: "How did you monitor it?" }), "You mentioned retries.");
  assert.equal(bridgeForSelection({ bridge: "You mentioned retries.", bridgeFor: "How did you monitor it?", originalPrompt: "How do you test changes?" }), null);
  assert.equal(bridgeForSelection({ bridge: "You mentioned retries.", bridgeFor: null, originalPrompt: "How did you monitor it?" }), null);
  assert.equal(bridgeForSelection({ bridge: null, bridgeFor: "How did you monitor it?", originalPrompt: "How did you monitor it?" }), null);
  assert.ok(MAX_POST_FOLLOW_UP_ANALYSES >= 1 && MAX_POST_FOLLOW_UP_ANALYSES < 12);
});

test("the ready bridge is found for the same turn, question, utterance and an epoch not newer than the final one", async () => {
  const { prewarm } = prewarmer();
  const registry = createPreparedBridgeRegistry();
  assert.equal(offer(registry, { prewarm }), true);
  assert.equal(registry.find({ turnId: "t1", speechEpoch: 1, prompt: "How did you monitor it?", utteranceFor: compose }), null, "audio not ready yet: never waited for");
  await flush();
  assert.equal(registry.find({ turnId: "t1", speechEpoch: 1, prompt: "How did you monitor it?", utteranceFor: compose }), "You mentioned retries.");
  assert.equal(registry.find({ turnId: "t1", speechEpoch: 3, prompt: "How did you monitor it?", utteranceFor: compose }), "You mentioned retries.", "an earlier epoch's bridge is still literal");
  assert.equal(registry.find({ turnId: "t1", speechEpoch: 0, prompt: "How did you monitor it?", utteranceFor: compose }), null, "a later epoch cannot be used");
  assert.equal(registry.find({ turnId: "t2", speechEpoch: 1, prompt: "How did you monitor it?", utteranceFor: compose }), null, "another answer");
  assert.equal(registry.find({ turnId: "t1", speechEpoch: 1, prompt: "How do you test changes?", utteranceFor: compose }), null, "a skipped or different question");
  assert.equal(registry.find({ turnId: "t1", speechEpoch: 1, prompt: "How did you monitor it?", utteranceFor: (bridge) => `Okay. ${compose(bridge)}` }), null, "the audio would not match");
});

test("only the newest bridge is held: an older offer is refused and a replaced one is cancelled", async () => {
  const { calls, prewarm } = prewarmer();
  const registry = createPreparedBridgeRegistry();
  offer(registry, { revision: 3, prewarm });
  assert.equal(offer(registry, { revision: 2, bridge: "You mentioned caching.", utterance: compose("You mentioned caching."), prewarm }), false);
  assert.equal(calls.length, 1);
  offer(registry, { revision: 4, prewarm });
  assert.equal(calls.length, 1, "the same utterance is not synthesized twice");
  offer(registry, { revision: 5, bridge: "You mentioned caching.", utterance: compose("You mentioned caching."), prewarm });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cancelled, true);
  await flush();
  assert.equal(registry.find({ turnId: "t1", speechEpoch: 1, prompt: "How did you monitor it?", utteranceFor: compose }), "You mentioned caching.");
  registry.clear();
  assert.equal(calls[1].cancelled, true);
  assert.equal(registry.find({ turnId: "t1", speechEpoch: 1, prompt: "How did you monitor it?", utteranceFor: compose }), null);
});

test("a new answer replaces the previous answer's bridge and a failed synthesis is never used", async () => {
  const registry = createPreparedBridgeRegistry();
  let cancelled = false;
  offer(registry, { revision: 9, prewarm: () => ({ firstChunkReady: Promise.resolve(true), cancel: () => { cancelled = true; } }) });
  offer(registry, { turnId: "t2", revision: 1, prewarm: () => ({ firstChunkReady: Promise.resolve(false), cancel() {} }) });
  assert.equal(cancelled, true);
  await flush();
  assert.equal(registry.find({ turnId: "t2", speechEpoch: 1, prompt: "How did you monitor it?", utteranceFor: compose }), null);
});

test("after a follow-up only a ready NEXT preparation of the exact final transcript, turn and epoch replaces the fixed path", async () => {
  const { canUsePostFollowUpPreparation } = await import("../src/lib/interview/prepared-bridge.mjs");
  const value = { turnId: "t1", speechEpoch: 2, transcript: "I added alerts for retries. ", decision: { decision: "NEXT", nextQuestion: "How do you test changes?" } };
  const base = { value, currentTurnId: "t1", currentSpeechEpoch: 2, finalTranscript: "I added alerts for retries." };
  assert.equal(canUsePostFollowUpPreparation(base), true);
  assert.equal(canUsePostFollowUpPreparation({ ...base, finalTranscript: "I added alerts for retries and dashboards." }), false, "different transcript");
  assert.equal(canUsePostFollowUpPreparation({ ...base, currentSpeechEpoch: 3 }), false, "older epoch");
  assert.equal(canUsePostFollowUpPreparation({ ...base, currentTurnId: "t2" }), false, "another answer");
  assert.equal(canUsePostFollowUpPreparation({ ...base, value: { ...value, decision: { decision: "FOLLOW_UP", nextQuestion: null } } }), false, "never a second follow-up");
  assert.equal(canUsePostFollowUpPreparation({ ...base, value: { ...value, decision: { decision: "NEXT", nextQuestion: null } } }), false, "nothing to ask");
  assert.equal(canUsePostFollowUpPreparation({ ...base, value: null }), false, "fixed fallback stays");
});
