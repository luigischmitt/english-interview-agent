import assert from "node:assert/strict";
import test from "node:test";
import { createNextTurnPreparationRegistry } from "../src/lib/interview/next-turn-preparation.mjs";
import { shouldUseMonotonicFixedFallback } from "../src/lib/interview/question-scheduling.mjs";
import { applyFollowUpCandidateClear, canUseCurrentEpochCandidate, candidateStatusFor, recordCandidateStatus, waitForFirstChunk, waitForPreparedTurnAudio } from "../src/lib/interview/speculative-epoch.mjs";

const candidate = { turnId: "turn-a", revision: 1, speechEpoch: 4, transcript: "I used Kafka.", decision: { decision: "FOLLOW_UP" }, anchor: "Kafka" };

test("candidate status and answer must belong to the current speech epoch", () => {
  const statuses = new Map();
  const latest = new Map();
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 3, revision: 1, status: "OPEN" }, 4), false);
  assert.equal(canUseCurrentEpochCandidate({ value: candidate, finalTranscript: "I used Kafka at scale.", currentTurnId: "turn-a", currentSpeechEpoch: 3, featureEnabled: true, compatibility: "OPEN" }), false);
  assert.equal(canUseCurrentEpochCandidate({ value: candidate, finalTranscript: "I used Kafka at scale.", currentTurnId: "turn-a", currentSpeechEpoch: 4, featureEnabled: true, compatibility: undefined }), false);
});

test("a newer NONE invalidates an older OPEN status in the same epoch", () => {
  const statuses = new Map();
  const latest = new Map();
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 4, revision: 1, status: "OPEN" }, 4), true);
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 4, revision: 2, status: "NONE" }, 4), true);
  assert.equal(candidateStatusFor(statuses, latest, 4, 1, 4), "NONE");
  assert.equal(canUseCurrentEpochCandidate({ value: candidate, finalTranscript: "I used Kafka at scale.", currentTurnId: "turn-a", currentSpeechEpoch: 4, featureEnabled: true, compatibility: candidateStatusFor(statuses, latest, 4, 1, 4) }), false);
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 4, revision: 1, status: "OPEN" }, 4), false, "late older statuses are ignored");
});

test("a duplicate or late OPEN cannot overwrite a terminal status for the same revision", () => {
  const statuses = new Map();
  const latest = new Map();
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 4, revision: 2, status: "OPEN" }, 4), true);
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 4, revision: 2, status: "NONE" }, 4), true);
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 4, revision: 2, status: "OPEN" }, 4), false);
  assert.equal(candidateStatusFor(statuses, latest, 4, 2, 4), "NONE");
});

test("an extended final transcript needs a valid OPEN status; an exact transcript remains compatible", () => {
  const input = { value: candidate, currentTurnId: "turn-a", currentSpeechEpoch: 4, featureEnabled: true };
  assert.equal(canUseCurrentEpochCandidate({ ...input, finalTranscript: "I used Kafka at scale.", compatibility: "OPEN" }), true);
  assert.equal(canUseCurrentEpochCandidate({ ...input, finalTranscript: "I used Kafka at scale.", compatibility: undefined }), false);
  assert.equal(canUseCurrentEpochCandidate({ ...input, finalTranscript: "I used Kafka.", compatibility: undefined }), true);
});

test("finalization waits at most 400 ms for the first chunk and succeeds if it arrives in time", async () => {
  let expire;
  const timers = { setTimeout: (callback, ms) => { assert.equal(ms, 400); expire = callback; return 1; }, clearTimeout: () => {} };
  let resolveSpeech;
  const pendingSpeech = new Promise((resolve) => { resolveSpeech = resolve; });
  const waiting = waitForFirstChunk(pendingSpeech, 400, timers);
  resolveSpeech(true);
  assert.equal(await waiting, true);

  const secondWait = waitForFirstChunk(new Promise(() => {}), 400, timers);
  expire();
  assert.equal(await secondWait, false);
});

test("text-only handoffs do not wait for audio readiness", async () => {
  assert.equal(await waitForFirstChunk(null, 400), false);
});

const never = () => new Promise(() => {});

test("B3: pending rev N plus rejected rev N-1 and no skip falls back to the fixed question without decideNextTurn", async () => {
  const registry = createNextTurnPreparationRegistry();
  const statuses = new Map();
  const latest = new Map();
  let decideNextTurnCalls = 0;
  const decideNextTurn = async () => { decideNextTurnCalls += 1; return { decision: "NEXT" }; };

  const older = registry.prepare({ transcript: "I used Kafka.", preserveReady: true, run: async () => ({ turnId: "t", revision: 1, speechEpoch: 4, transcript: "I used Kafka.", decision: { decision: "NEXT" }, anchor: null }) });
  await older.promise;
  registry.prepare({ transcript: "I used Kafka at scale for events.", preserveReady: true, run: never });
  const finalTranscript = "I used Kafka at scale for events, and then I led the migration.";
  const taken = registry.takeAnyReady({ accept: (value) => canUseCurrentEpochCandidate({ value, finalTranscript, currentTurnId: "t", currentSpeechEpoch: 4, featureEnabled: true, compatibility: candidateStatusFor(statuses, latest, value.speechEpoch, value.revision, 4) }) });
  assert.equal(taken, null);

  let decision = null;
  if (shouldUseMonotonicFixedFallback({ speculationAttempted: true, speculationEnabled: true, skipCommitted: false })) decision = { decision: "NEXT", fixed: true };
  decision ??= await decideNextTurn();
  assert.equal(decision.fixed, true);
  assert.equal(decideNextTurnCalls, 0);
});

test("B3: an analysis that timed out or failed still ends in the fixed fallback", () => {
  // requestSpeculativeTurn resolves { enabled: false, analysis: null } on timeout; the status endpoint had said enabled.
  assert.equal(shouldUseMonotonicFixedFallback({ speculationAttempted: true, speculationEnabled: true, skipCommitted: false }), true);
});

test("S3: a ready FOLLOW_UP is not delayed by unrelated adapted fixed-question audio", async () => {
  const started = Date.now();
  const result = await waitForPreparedTurnAudio({ decision: { decision: "FOLLOW_UP" }, speechReady: Promise.resolve(true), adaptedFixedQuestion: true, fixedQuestionAudioReady: never() }, 400);
  assert.deepEqual(result, { firstChunkReady: true, adaptedQuestionReady: false });
  assert.ok(Date.now() - started < 200, "must not wait for the fixed audio");
});

test("S3: a NEXT still waits (capped) for the adapted fixed audio", async () => {
  const ready = await waitForPreparedTurnAudio({ decision: { decision: "NEXT" }, speechReady: Promise.resolve(true), adaptedFixedQuestion: true, fixedQuestionAudioReady: Promise.resolve(true) }, 400);
  assert.deepEqual(ready, { firstChunkReady: true, adaptedQuestionReady: true });
  const started = Date.now();
  const slow = await waitForPreparedTurnAudio({ decision: { decision: "NEXT" }, speechReady: Promise.resolve(true), adaptedFixedQuestion: true, fixedQuestionAudioReady: never() }, 50);
  assert.deepEqual(slow, { firstChunkReady: true, adaptedQuestionReady: false });
  assert.ok(Date.now() - started < 300);
});

test("S4: a newer NONE discards an older OPEN FOLLOW_UP even with a differing transcript, cancelling its audio", async () => {
  const registry = createNextTurnPreparationRegistry();
  const statuses = new Map();
  const latest = new Map();
  let audioCancelled = false;
  const followUp = { turnId: "t", revision: 1, speechEpoch: 4, transcript: "I used Kafka.", decision: { decision: "FOLLOW_UP" }, anchor: "Kafka" };
  const entry = registry.prepare({ transcript: "I used Kafka.", preserveReady: true, run: async (_signal, onCleanup) => { onCleanup(() => { audioCancelled = true; }); return followUp; } });
  await entry.promise;
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 4, revision: 1, status: "OPEN" }, 4), true);
  registry.prepare({ transcript: "I used Kafka and Redis.", preserveReady: true, run: never });

  assert.equal(applyFollowUpCandidateClear({ registry, statuses, latestByEpoch: latest, speechEpoch: 4, revision: 2, currentSpeechEpoch: 4 }), 1);
  assert.equal(audioCancelled, true);
  assert.equal(candidateStatusFor(statuses, latest, 4, 2, 4), "NONE");
  assert.equal(candidateStatusFor(statuses, latest, 4, 1, 4), "NONE");

  const finalTranscript = "I used Kafka at scale.";
  const taken = registry.takeAnyReady({ accept: (value) => canUseCurrentEpochCandidate({ value, finalTranscript, currentTurnId: "t", currentSpeechEpoch: 4, featureEnabled: true, compatibility: candidateStatusFor(statuses, latest, value.speechEpoch, value.revision, 4) }) });
  assert.equal(taken, null);
});

test("S4: a clear of one epoch never discards other epochs, and an exact NEXT preparation survives its own NONE", async () => {
  const registry = createNextTurnPreparationRegistry();
  const statuses = new Map();
  const latest = new Map();
  const otherEpoch = { turnId: "t", revision: 1, speechEpoch: 3, transcript: "x", decision: { decision: "FOLLOW_UP" }, anchor: "x" };
  await registry.prepare({ transcript: "x", preserveReady: true, run: async () => otherEpoch }).promise;
  assert.equal(applyFollowUpCandidateClear({ registry, statuses, latestByEpoch: latest, speechEpoch: 4, revision: 2, currentSpeechEpoch: 4 }), 0);

  const next = { turnId: "t", revision: 2, speechEpoch: 4, transcript: "I led it.", decision: { decision: "NEXT" }, anchor: null };
  assert.equal(canUseCurrentEpochCandidate({ value: next, finalTranscript: "I led it.", currentTurnId: "t", currentSpeechEpoch: 4, featureEnabled: true, compatibility: candidateStatusFor(statuses, latest, 4, 2, 4) }), true);
  const followUpSameTranscript = { ...next, decision: { decision: "FOLLOW_UP" }, anchor: "led" };
  assert.equal(canUseCurrentEpochCandidate({ value: followUpSameTranscript, finalTranscript: "I led it.", currentTurnId: "t", currentSpeechEpoch: 4, featureEnabled: true, compatibility: "NONE" }), false);
});
