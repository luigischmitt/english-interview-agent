import assert from "node:assert/strict";
import test from "node:test";
import { createNextTurnPreparationRegistry } from "../src/lib/interview/next-turn-preparation.mjs";
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
