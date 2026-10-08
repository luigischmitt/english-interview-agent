import assert from "node:assert/strict";
import test from "node:test";
import { createNextTurnPreparationRegistry } from "../src/lib/interview/next-turn-preparation.mjs";
import { canUseSpeculativePreparation, followUpSpeechReadyByAcknowledgement } from "../src/lib/interview/speculative-preparation-policy.mjs";
import { clearRetainedSpeechBlobs, playInterviewerSegments, prewarmInterviewerSpeech } from "../src/lib/interview/speech-playback.mjs";


const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test("a matching transcript claims the prepared value, trimming whitespace", async () => {
  const registry = createNextTurnPreparationRegistry();
  registry.prepare({ transcript: " I led the migration. ", inputKey: "k", run: async () => ({ decision: "NEXT" }) });
  const entry = registry.take({ transcript: "I led the migration.", inputKey: "k" });
  assert.ok(entry);
  assert.deepEqual(await entry.promise, { decision: "NEXT" });
  assert.deepEqual(registry.stats(), { used: 1, discarded: 0 });
  assert.equal(registry.take({ transcript: "I led the migration.", inputKey: "k" }), null);
});

test("a different transcript or different inputs is discarded and aborted, never applied", async () => {
  const registry = createNextTurnPreparationRegistry();
  let signal;
  let cleaned = 0;
  registry.prepare({ transcript: "First", inputKey: "k", run: (s, onCleanup) => { signal = s; onCleanup(() => { cleaned += 1; }); return new Promise(() => {}); } });
  assert.equal(registry.take({ transcript: "First and more", inputKey: "k" }), null);
  assert.equal(signal.aborted, true);
  assert.equal(cleaned, 1);
  registry.prepare({ transcript: "First", inputKey: "k1", run: async () => 1 });
  assert.equal(registry.take({ transcript: "First", inputKey: "k2" }), null);
  assert.deepEqual(registry.stats(), { used: 0, discarded: 2 });
});

test("a new preparation replaces and aborts the previous one; abort() discards the latest", async () => {
  const registry = createNextTurnPreparationRegistry();
  const signals = [];
  for (const transcript of ["a", "b"]) registry.prepare({ transcript, run: (s) => { signals.push(s); return new Promise(() => {}); } });
  assert.deepEqual(signals.map((s) => s.aborted), [true, false]);
  assert.equal(registry.hasPending(), true);
  registry.abort();
  assert.equal(signals[1].aborted, true);
  assert.equal(registry.hasPending(), false);
  assert.equal(registry.take({ transcript: "b" }), null);
  assert.deepEqual(registry.stats(), { used: 0, discarded: 2 });
});

test("a failed preparation is never used, and a pending one can be awaited", async () => {
  const registry = createNextTurnPreparationRegistry();
  registry.prepare({ transcript: "x", run: async () => { throw new Error("boom"); } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(registry.take({ transcript: "x" }), null);

  const gate = deferred();
  registry.prepare({ transcript: "y", run: () => gate.promise });
  const entry = registry.take({ transcript: "y" });
  gate.resolve("decided");
  assert.equal(await entry.promise, "decided");
});

test("an unusable claimed entry can be released as discarded; used entries are not aborted", async () => {
  const registry = createNextTurnPreparationRegistry();
  let cleaned = 0;
  const entry = registry.prepare({ transcript: "z", run: async (_s, onCleanup) => { onCleanup(() => { cleaned += 1; }); return null; } });
  const claimed = registry.take({ transcript: "z" });
  assert.equal(await claimed.promise, null);
  registry.release(entry);
  assert.deepEqual(registry.stats(), { used: 0, discarded: 1 });
  assert.equal(cleaned, 1);

  registry.prepare({ transcript: "w", run: async (_s, onCleanup) => { onCleanup(() => { cleaned += 1; }); return 1; } });
  const kept = registry.take({ transcript: "w" });
  registry.abort();
  assert.equal(kept.controller.signal.aborted, false);
  assert.equal(cleaned, 1);
});

test("empty provisional transcripts are ignored", () => {
  const registry = createNextTurnPreparationRegistry();
  assert.equal(registry.prepare({ transcript: "   ", run: async () => 1 }), null);
  assert.equal(registry.hasPending(), false);
});

test("takeReady never waits for pending speculative work", async () => {
  const registry = createNextTurnPreparationRegistry();
  const gate = deferred();
  registry.prepare({ transcript: "pending", inputKey: "k", run: () => gate.promise });
  assert.equal(registry.takeReady({ transcript: "pending", inputKey: "k" }), null);
  assert.equal(registry.hasPending(), false);
  gate.resolve("late");
});

test("takeAnyReady accepts only a ready semantically compatible revision", async () => {
  const registry = createNextTurnPreparationRegistry();
  registry.prepare({ transcript: "I used Kafka.", run: async () => ({ revision: 1, anchor: "Kafka" }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const entry = registry.takeAnyReady({ accept: (value) => value.revision === 1 && value.anchor === "Kafka" });
  assert.deepEqual(await entry.promise, { revision: 1, anchor: "Kafka" });

  registry.prepare({ transcript: "old", run: async () => ({ revision: 1, anchor: "Redis" }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(registry.takeAnyReady({ accept: (value) => value.anchor === "Kafka" }), null);
  assert.deepEqual(registry.stats(), { used: 1, discarded: 1 });
});

test("a ready earlier revision survives while a newer revision is pending", async () => {
  const registry = createNextTurnPreparationRegistry();
  const earlier = registry.prepare({ transcript: "I used Kafka.", preserveReady: true, run: async () => ({ revision: 1, anchor: "Kafka" }) });
  await earlier.promise;
  let newerSignal;
  registry.prepare({ transcript: "I used Kafka in production.", preserveReady: true, run: (signal) => { newerSignal = signal; return new Promise(() => {}); } });

  const entry = registry.takeAnyReady({ accept: (value) => value.anchor === "Kafka" });
  assert.equal(entry, earlier);
  assert.deepEqual(await entry.promise, { revision: 1, anchor: "Kafka" });
  assert.equal(newerSignal.aborted, true, "unfinished newer work is cancelled at finalization");
  assert.deepEqual(registry.stats(), { used: 1, discarded: 1 });
});

test("takeAnyReady selects the newest compatible prepared revision", async () => {
  const registry = createNextTurnPreparationRegistry();
  registry.prepare({ transcript: "revision one", preserveReady: true, run: async () => ({ revision: 1, anchor: "Kafka" }) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  registry.prepare({ transcript: "revision two", preserveReady: true, run: async () => ({ revision: 2, anchor: "Kafka" }) });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const entry = registry.takeAnyReady({ accept: (value) => value.anchor === "Kafka" });
  assert.equal(entry.value.revision, 2);
  assert.deepEqual(registry.stats(), { used: 1, discarded: 1 });
});

test("final transcript accepts an exact snapshot unless compatibility invalidates it", () => {
  const value = { turnId: "turn-a", revision: 2, transcript: "I led the migration.", decision: { decision: "NEXT" }, anchor: null };
  const input = { value, finalTranscript: " I led the migration. ", currentTurnId: "turn-a", featureEnabled: true, compatibility: undefined };
  assert.equal(canUseSpeculativePreparation(input), true);
  assert.equal(canUseSpeculativePreparation({ ...input, compatibility: "COVERED" }), false);
  assert.equal(canUseSpeculativePreparation({ ...input, compatibility: "INVALID" }), false);
  assert.equal(canUseSpeculativePreparation({ ...input, compatibility: "NONE" }), false);
});

test("an extended final transcript reuses only an open anchored follow-up from this turn", () => {
  const value = { turnId: "turn-a", revision: 1, transcript: "I used Kafka.", decision: { decision: "FOLLOW_UP" }, anchor: "Kafka" };
  const input = { value, finalTranscript: "I used Kafka to process events.", currentTurnId: "turn-a", featureEnabled: true, compatibility: "OPEN" };
  assert.equal(canUseSpeculativePreparation(input), true);
  assert.equal(canUseSpeculativePreparation({ ...input, compatibility: "COVERED" }), false);
  assert.equal(canUseSpeculativePreparation({ ...input, compatibility: "INVALID" }), false);
  assert.equal(canUseSpeculativePreparation({ ...input, compatibility: undefined }), false);
  assert.equal(canUseSpeculativePreparation({ ...input, currentTurnId: "turn-b" }), false);
  assert.equal(canUseSpeculativePreparation({ ...input, featureEnabled: false }), false);
  assert.equal(canUseSpeculativePreparation({ ...input, finalTranscript: "I used Redis." }), false);
  assert.equal(canUseSpeculativePreparation({ ...input, value: { ...value, decision: { decision: "NEXT" } } }), false);
});

test("anchor compatibility ignores casing, punctuation, hyphens, and accents", () => {
  const value = { turnId: "turn-a", revision: 2, transcript: "I improved Kafka.", decision: { decision: "FOLLOW_UP" }, anchor: "KAFKA pipeline" };
  assert.equal(canUseSpeculativePreparation({
    value,
    finalTranscript: "I improved the kafka-pipeline used for cobrança events.",
    currentTurnId: "turn-a",
    featureEnabled: true,
    compatibility: "OPEN",
  }), true);
  assert.equal(canUseSpeculativePreparation({
    value: { ...value, anchor: "cobranca events" },
    finalTranscript: "I improved the pipeline for cobrança events.",
    currentTurnId: "turn-a",
    featureEnabled: true,
    compatibility: "OPEN",
  }), true);
});

test("a speculative follow-up gets only the acknowledgement interval for speech synthesis", async () => {
  const speech = deferred();
  const acknowledgement = deferred();
  const choice = followUpSpeechReadyByAcknowledgement({
    decision: { decision: "FOLLOW_UP" }, speechReady: speech.promise, audioEnabled: true, acknowledgementIdle: acknowledgement.promise,
  });
  acknowledgement.resolve();
  assert.equal(await choice, false);
  speech.resolve(true);

  const readySpeech = deferred();
  const liveAcknowledgement = deferred();
  const readyChoice = followUpSpeechReadyByAcknowledgement({
    decision: { decision: "FOLLOW_UP" }, speechReady: readySpeech.promise, audioEnabled: true, acknowledgementIdle: liveAcknowledgement.promise,
  });
  readySpeech.resolve(true);
  assert.equal(await readyChoice, true);
  liveAcknowledgement.resolve();
});

test("text-only follow-ups do not wait for speech synthesis or acknowledgement", async () => {
  const never = deferred();
  assert.equal(await followUpSpeechReadyByAcknowledgement({
    decision: { decision: "FOLLOW_UP" }, speechReady: never.promise, audioEnabled: false, acknowledgementIdle: never.promise,
  }), true);
  assert.equal(typeof never.resolve, "function");
});

class FakeAudio {
  listeners = new Map();
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener() {}
  pause() {}
  removeAttribute() {}
  load() {}
  play() { this.listeners.get("ended")?.(); return Promise.resolve(); }
}
const stubTimers = { setTimeout: () => 1, clearTimeout: () => {} };

function speechFetcher(calls) {
  return async (_url, init) => {
    calls.push(init.body);
    return { ok: true, blob: async () => new Blob([init.body]) };
  };
}

test("pre-synthesized speech is reused by an identical playback without a second request", async () => {
  clearRetainedSpeechBlobs();
  const calls = [];
  const fetcher = speechFetcher(calls);
  const prewarm = prewarmInterviewerSpeech(["Thanks.", "Why Redis?"], { endpoint: "/speech", fetcher, retainMs: 5_000 });
  assert.equal(await prewarm.promise, true);
  const playback = playInterviewerSegments(["Thanks.", "Why Redis?"], { endpoint: "/speech", fetcher, makeAudio: () => new FakeAudio(), createObjectUrl: () => "blob:x", revokeObjectUrl() {}, ...stubTimers });
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.equal(calls.length, 1);
  clearRetainedSpeechBlobs();
});

test("a prewarm becomes playable when its first chunk is ready while later chunks are still in flight", async () => {
  clearRetainedSpeechBlobs();
  let calls = 0;
  const prewarm = prewarmInterviewerSpeech(["Thanks for that.", "How did you measure the result after the launch, and which production metric gave you the clearest evidence that the change worked for customers?"], {
    endpoint: "/speech-first-ready",
    fetcher: async (_url, init) => {
      calls += 1;
      if (calls === 1) return { ok: true, blob: async () => new Blob([init.body]) };
      return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    },
    retainMs: 5_000,
  });
  assert.equal(await prewarm.firstChunkReady, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2, "the next chunk starts in the background after chunk 1");
  prewarm.cancel();
  assert.equal(await prewarm.promise, false);
  clearRetainedSpeechBlobs();
});

test("separately prepared transition and fixed question are reused by combined playback", async () => {
  clearRetainedSpeechBlobs();
  const calls = [];
  const fetcher = speechFetcher(calls);
  const options = { endpoint: "/fixed", fetcher, retainMs: 240_000, voice: "am_echo" };
  await Promise.all([
    prewarmInterviewerSpeech(["Let's move to a different topic."], options).promise,
    prewarmInterviewerSpeech(["How did you monitor the service in production?"], options).promise,
  ]);
  const playback = playInterviewerSegments(["Let's move to a different topic.", "How did you monitor the service in production?"], { ...options, makeAudio: () => new FakeAudio(), createObjectUrl: () => "blob:x", revokeObjectUrl() {}, ...stubTimers });
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.equal(calls.length, 2);
  clearRetainedSpeechBlobs();
});

test("a voice change uses a distinct prepared-audio key", async () => {
  clearRetainedSpeechBlobs();
  const calls = [];
  const fetcher = speechFetcher(calls);
  await prewarmInterviewerSpeech(["How did you monitor it?"], { endpoint: "/voice", fetcher, retainMs: 240_000, voice: "am_echo" }).promise;
  await prewarmInterviewerSpeech(["How did you monitor it?"], { endpoint: "/voice", fetcher, retainMs: 240_000, voice: "af_heart" }).promise;
  assert.equal(calls.length, 2);
  clearRetainedSpeechBlobs();
});

test("cancelling a prewarm aborts the request, but not when a playback has attached", async () => {
  clearRetainedSpeechBlobs();
  let aborted = 0;
  const hanging = (_url, init) => new Promise((_resolve, reject) => {
    const onAbort = () => { aborted += 1; reject(new Error("aborted")); };
    if (init.signal.aborted) onAbort();
    else init.signal.addEventListener("abort", onAbort);
  });
  const prewarm = prewarmInterviewerSpeech(["Question one?"], { endpoint: "/a", fetcher: hanging });
  prewarm.cancel();
  assert.equal(await prewarm.promise, false);
  assert.equal(aborted, 1);

  const prewarm2 = prewarmInterviewerSpeech(["Question two?"], { endpoint: "/b", fetcher: hanging });
  const playback = playInterviewerSegments(["Question two?"], { endpoint: "/b", fetcher: hanging, makeAudio: () => new FakeAudio(), ...stubTimers });
  await new Promise((resolve) => setTimeout(resolve, 5));
  prewarm2.cancel();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(aborted, 1);
  playback.cancel();
  await playback.promise;
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(aborted, 2);
});

test("retained speech expires after the retention window", async () => {
  clearRetainedSpeechBlobs();
  const calls = [];
  const fetcher = speechFetcher(calls);
  await prewarmInterviewerSpeech(["Short lived."], { endpoint: "/c", fetcher, retainMs: 20 }).promise;
  await new Promise((resolve) => setTimeout(resolve, 60));
  await prewarmInterviewerSpeech(["Short lived."], { endpoint: "/c", fetcher, retainMs: 20 }).promise;
  assert.equal(calls.length, 2);
  clearRetainedSpeechBlobs();
});
