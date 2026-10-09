import assert from "node:assert/strict";
import test from "node:test";
import { createNextTurnPreparationRegistry } from "../src/lib/interview/next-turn-preparation.mjs";
import { shouldUseMonotonicFixedFallback } from "../src/lib/interview/question-scheduling.mjs";
import { adoptSpeechEpoch, applyFollowUpCandidateClear, canUseCurrentEpochCandidate, candidateStatusFor, discardCoveredFollowUps, finalEpochCandidateStatus, recordCandidateStatus, waitForFirstChunk, waitForPreparedTurnAudio } from "../src/lib/interview/speculative-epoch.mjs";

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

test("S4: a newer NONE retires older FOLLOW_UP preparations of any epoch, and an exact NEXT preparation survives its own NONE", async () => {
  const registry = createNextTurnPreparationRegistry();
  const statuses = new Map();
  const latest = new Map();
  const otherEpoch = { turnId: "t", revision: 1, speechEpoch: 3, transcript: "x", decision: { decision: "FOLLOW_UP" }, anchor: "x" };
  await registry.prepare({ transcript: "x", preserveReady: true, run: async () => otherEpoch }).promise;
  assert.equal(applyFollowUpCandidateClear({ registry, statuses, latestByEpoch: latest, speechEpoch: 4, revision: 2, currentSpeechEpoch: 4 }), 1);

  const next = { turnId: "t", revision: 2, speechEpoch: 4, transcript: "I led it.", decision: { decision: "NEXT" }, anchor: null };
  assert.equal(canUseCurrentEpochCandidate({ value: next, finalTranscript: "I led it.", currentTurnId: "t", currentSpeechEpoch: 4, featureEnabled: true, compatibility: candidateStatusFor(statuses, latest, 4, 2, 4) }), true);
  const followUpSameTranscript = { ...next, decision: { decision: "FOLLOW_UP" }, anchor: "led" };
  assert.equal(canUseCurrentEpochCandidate({ value: followUpSameTranscript, finalTranscript: "I led it.", currentTurnId: "t", currentSpeechEpoch: 4, featureEnabled: true, compatibility: "NONE" }), false);
});

const followUp = (revision, speechEpoch, transcript = "I used Kafka.") => ({ turnId: "t", revision, speechEpoch, transcript, decision: { decision: "FOLLOW_UP" }, anchor: "Kafka" });
const usable = (registry, statuses, latest, finalEpoch, finalTranscript) => registry.takeAnyReady({ accept: (value) => canUseCurrentEpochCandidate({
  value, finalTranscript, currentTurnId: "t", currentSpeechEpoch: finalEpoch, featureEnabled: true,
  compatibility: finalEpochCandidateStatus(statuses, latest, value.revision, finalEpoch),
}) });

test("A: six pause/resume cycles keep the preparation, bounded by the eight-analysis cap, and the final-epoch OPEN uses it with its audio", async () => {
  const registry = createNextTurnPreparationRegistry();
  const statuses = new Map();
  const latest = new Map();
  let audioCancelled = 0;
  let epoch = null;
  const calls = { count: 0 };
  for (let cycle = 0; cycle < 6; cycle += 1) {
    // pause start: provisional of epoch `cycle` and a new revision
    epoch = adoptSpeechEpoch(epoch, cycle);
    if (calls.count < 8) {
      calls.count += 1;
      const revision = cycle + 1;
      const entry = registry.prepare({ transcript: `I used Kafka ${cycle}.`, preserveReady: true, run: async (_s, onCleanup) => { onCleanup(() => { audioCancelled += 1; }); return followUp(revision, cycle, `I used Kafka ${cycle}.`); } });
      await entry.promise;
    }
    // resume: the frontend only forgets the epoch; nothing is discarded
    epoch = null;
  }
  assert.equal(audioCancelled, 0, "no prewarmed audio is discarded by resumes");
  assert.ok(calls.count <= 8);
  // final pause: backend reports OPEN for the candidate (revision 6) in the final epoch 6
  epoch = adoptSpeechEpoch(epoch, 6);
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 6, revision: 6, status: "OPEN" }, epoch), true);
  const taken = usable(registry, statuses, latest, epoch, "I used Kafka 5. And then we scaled it.");
  assert.equal(taken.value.revision, 6);
  assert.equal(audioCancelled, 5, "only the superseded preparations are cancelled");
});

test("A: a status from an older epoch only never lets an extended answer use the follow-up", async () => {
  const registry = createNextTurnPreparationRegistry();
  const statuses = new Map();
  const latest = new Map();
  await registry.prepare({ transcript: "I used Kafka.", preserveReady: true, run: async () => followUp(1, 2) }).promise;
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 2, revision: 1, status: "OPEN" }, 2), true);
  // speech resumed, the final epoch is 3 and has no status (or the epoch is still unknown)
  assert.equal(usable(registry, statuses, latest, 3, "I used Kafka. And more."), null);
});

test("A: the older-epoch preparation is discarded rather than leaked when unusable", async () => {
  const registry = createNextTurnPreparationRegistry();
  const statuses = new Map();
  const latest = new Map();
  let cancelled = false;
  await registry.prepare({ transcript: "I used Kafka.", preserveReady: true, run: async (_s, onCleanup) => { onCleanup(() => { cancelled = true; }); return followUp(1, 2); } }).promise;
  assert.equal(usable(registry, statuses, latest, null, "I used Kafka. And more."), null);
  assert.equal(cancelled, true);
});

test("A: COVERED in the final epoch and an explicit newer NONE both fall back to the fixed question", async () => {
  for (const scenario of ["covered", "none"]) {
    const registry = createNextTurnPreparationRegistry();
    const statuses = new Map();
    const latest = new Map();
    await registry.prepare({ transcript: "I used Kafka.", preserveReady: true, run: async () => followUp(1, 0) }).promise;
    if (scenario === "covered") recordCandidateStatus(statuses, latest, { speechEpoch: 3, revision: 1, status: "COVERED" }, 3);
    else {
      recordCandidateStatus(statuses, latest, { speechEpoch: 3, revision: 1, status: "OPEN" }, 3);
      recordCandidateStatus(statuses, latest, { speechEpoch: 3, revision: 2, status: "NONE" }, 3);
    }
    assert.equal(usable(registry, statuses, latest, 3, "I used Kafka. And more."), null, scenario);
  }
});

test("A: an exact analyzed transcript is usable from an earlier epoch without a status; a later epoch than final never is", async () => {
  const registry = createNextTurnPreparationRegistry();
  await registry.prepare({ transcript: "I used Kafka.", preserveReady: true, run: async () => followUp(1, 1) }).promise;
  assert.ok(usable(registry, new Map(), new Map(), 3, "I used Kafka."));
  assert.equal(canUseCurrentEpochCandidate({ value: followUp(1, 5), finalTranscript: "I used Kafka.", currentTurnId: "t", currentSpeechEpoch: 3, featureEnabled: true, compatibility: "OPEN" }), false);
});

test("A: a newer NONE resolution cancels retained older-epoch audio; resume must not play audio (nothing plays before submit)", async () => {
  const registry = createNextTurnPreparationRegistry();
  let cancelled = 0;
  let played = 0;
  await registry.prepare({ transcript: "I used Kafka.", preserveReady: true, run: async (_s, onCleanup) => { onCleanup(() => { cancelled += 1; }); return { ...followUp(1, 0), speechReady: Promise.resolve(true), play: () => { played += 1; } }; } }).promise;
  // speech resumed: the frontend handler only nulls the epoch, so no entry is discarded and none is played
  assert.equal(adoptSpeechEpoch(0, null), 0);
  assert.equal(cancelled, 0);
  assert.equal(played, 0);
  assert.equal(applyFollowUpCandidateClear({ registry, statuses: new Map(), latestByEpoch: new Map(), speechEpoch: 2, revision: 2, currentSpeechEpoch: 2 }), 1);
  assert.equal(cancelled, 1);
  assert.equal(played, 0);
});

test("A: the speech epoch only moves forward and adopts the first epoch after a resume", () => {
  assert.equal(adoptSpeechEpoch(null, 4), 4);
  assert.equal(adoptSpeechEpoch(4, 3), 4);
  assert.equal(adoptSpeechEpoch(4, 5), 5);
  assert.equal(adoptSpeechEpoch(4, undefined), 4);
});

test("COVERED is sticky across epochs: the repro after a cough-triggered resume never plays the covered follow-up", () => {
  const statuses = new Map();
  const latest = new Map();
  const registry = createNextTurnPreparationRegistry();
  assert.equal(recordCandidateStatus(statuses, latest, { speechEpoch: 0, revision: 1, status: "COVERED" }, 0), true);
  const value = { ...candidate, speechEpoch: 0, revision: 1 };
  // Resume: epoch unknown (null); identical transcript, no new status.
  const compatibility = finalEpochCandidateStatus(statuses, latest, 1, null);
  assert.equal(compatibility, "COVERED");
  assert.equal(canUseCurrentEpochCandidate({ value, finalTranscript: value.transcript, currentTurnId: "turn-a", currentSpeechEpoch: null, featureEnabled: true, compatibility }), false);
  // Epoch 1 without a status for it must still reject.
  assert.equal(canUseCurrentEpochCandidate({ value, finalTranscript: value.transcript, currentTurnId: "turn-a", currentSpeechEpoch: 1, featureEnabled: true, compatibility: finalEpochCandidateStatus(statuses, latest, 1, 1) }), false);
  assert.equal(registry.stats().used, 0);
});

test("INVALID is sticky for older revisions too; NONE is not sticky", () => {
  const statuses = new Map();
  const latest = new Map();
  recordCandidateStatus(statuses, latest, { speechEpoch: 0, revision: 2, status: "INVALID" }, 0);
  assert.equal(finalEpochCandidateStatus(statuses, latest, 1, 1), "INVALID");
  assert.equal(finalEpochCandidateStatus(statuses, latest, 3, 1), undefined);
  const none = new Map();
  const noneLatest = new Map();
  recordCandidateStatus(none, noneLatest, { speechEpoch: 0, revision: 1, status: "NONE" }, 0);
  assert.equal(finalEpochCandidateStatus(none, noneLatest, 1, 1), undefined);
  assert.equal(canUseCurrentEpochCandidate({ value: { ...candidate, speechEpoch: 0 }, finalTranscript: candidate.transcript, currentTurnId: "turn-a", currentSpeechEpoch: 1, featureEnabled: true, compatibility: finalEpochCandidateStatus(none, noneLatest, 1, 1) }), true);
});

test("a COVERED/INVALID status discards retained follow-up preparations up to its revision, not NONE", async () => {
  const registry = createNextTurnPreparationRegistry();
  const cleaned = [];
  for (const revision of [1, 2, 3]) {
    const entry = registry.prepare({ transcript: `a${revision}`, preserveReady: true, run: async (_signal, onCleanup) => { onCleanup(() => cleaned.push(revision)); return { decision: { decision: "FOLLOW_UP" }, revision }; } });
    await entry.promise;
  }
  assert.equal(discardCoveredFollowUps(registry, { revision: 2, status: "NONE" }), 0);
  assert.equal(discardCoveredFollowUps(registry, { revision: 2, status: "COVERED" }), 2);
  assert.deepEqual(cleaned.sort(), [1, 2]);
});
