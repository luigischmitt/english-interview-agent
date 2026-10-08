import assert from "node:assert/strict";
import test from "node:test";
import { canUseCurrentEpochCandidate, candidateStatusFor, recordCandidateStatus, waitForFirstChunk } from "../src/lib/interview/speculative-epoch.mjs";

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
