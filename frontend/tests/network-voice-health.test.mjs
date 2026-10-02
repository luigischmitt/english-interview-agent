import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  FIRST_AUDIO_FALLBACK_MS, NETWORK_VOICE_COOLDOWN_MS, resetSpeechFlights, clearRetainedSpeechBlobs, markNetworkVoiceFailed, markNetworkVoiceHealthy,
  playInterviewerSegments, prewarmInterviewerSpeech, resetNetworkVoiceHealth, shouldSkipNetworkVoice, synthesizeInterviewerQuestion,
} from "../src/lib/interview/speech-playback.mjs";

beforeEach(() => { resetNetworkVoiceHealth(); clearRetainedSpeechBlobs(); resetSpeechFlights(); });

const flush = () => new Promise((resolve) => setImmediate(resolve));
const chunkA = "Thanks for that detailed answer about caching.";
const chunkB = "How did you invalidate entries across regions?";

class FakeUtterance { constructor(text) { this.text = text; } }
class FakeAudio {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  removeAttribute() {}
  load() {}
  pause() {}
  play() { return Promise.resolve(); }
  emit(type) { this.listeners.get(type)?.(); }
}

function harness({ browser = true } = {}) {
  const requests = [];
  const pending = new Map();
  const audios = [];
  const timers = new Map();
  let timerId = 0;
  const clock = { value: 1_000_000 };
  const synthesis = { spoken: [], getVoices: () => [], speak: (utterance) => synthesis.spoken.push(utterance), cancel() {} };
  const fetcher = (_endpoint, init) => new Promise((resolve, reject) => {
    const text = JSON.parse(init.body).text;
    requests.push(text);
    init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    pending.set(text, {
      ok: () => resolve({ ok: true, blob: async () => new Blob([text]) }),
      status: (status) => resolve({ ok: false, status, json: async () => ({ error: { message: "x" } }) }),
    });
  });
  const options = {
    endpoint: "/speech", fetcher,
    now: () => clock.value,
    makeAudio: () => { const audio = new FakeAudio(); audios.push(audio); return audio; },
    createObjectUrl: (blob) => `blob:${blob.size}`,
    revokeObjectUrl() {},
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    browserVoice: browser ? { speechSynthesis: synthesis, makeUtterance: (text) => new FakeUtterance(text), voice: null } : { speechSynthesis: null },
  };
  const fireDeadline = () => {
    const [id, timer] = [...timers].find(([, entry]) => entry.delay === FIRST_AUDIO_FALLBACK_MS);
    timers.delete(id);
    timer.callback();
  };
  return { requests, pending, audios, timers, clock, synthesis, options, fireDeadline };
}

// A real failure (HTTP 500 before the deadline) arms the cooldown; a merely slow request does not (see the slow tests below).
async function failOnce(h) {
  const playback = playInterviewerSegments([chunkA, chunkB], h.options);
  await flush();
  h.pending.get(chunkA).status(500);
  await flush();
  h.synthesis.spoken[0].onstart();
  h.synthesis.spoken[0].onend();
  h.synthesis.spoken[1].onstart();
  h.synthesis.spoken[1].onend();
  assert.deepEqual(await playback.promise, { status: "completed", voice: "browser" });
}

test("health state: cooldown window, expiry and recovery", () => {
  assert.equal(shouldSkipNetworkVoice(0), false);
  markNetworkVoiceFailed(1_000);
  assert.equal(shouldSkipNetworkVoice(1_000 + NETWORK_VOICE_COOLDOWN_MS - 1), true);
  assert.equal(shouldSkipNetworkVoice(1_000 + NETWORK_VOICE_COOLDOWN_MS), false);
  markNetworkVoiceHealthy();
  assert.equal(shouldSkipNetworkVoice(1_001), false);
});

test("after one fallback the next utterance uses the browser voice with no requests and no deadline", async () => {
  const h = harness();
  await failOnce(h);
  const before = h.requests.length;
  h.synthesis.spoken.length = 0;
  h.timers.clear();
  const log = [];
  const playback = playInterviewerSegments([chunkA, chunkB], {
    ...h.options,
    onPlaybackStarted: () => log.push("started"), onBrowserVoiceStarted: () => log.push("browser"),
    onSegment: (segment) => log.push(segment), onFinalChunkStarted: () => log.push("final"),
  });
  await flush();
  assert.equal(h.requests.length, before, "no network request");
  assert.ok(![...h.timers.values()].some((timer) => timer.delay === FIRST_AUDIO_FALLBACK_MS), "no 4 s wait");
  assert.equal(h.synthesis.spoken.length, 1);
  h.synthesis.spoken[0].onstart();
  h.synthesis.spoken[0].onend();
  h.synthesis.spoken[1].onstart();
  h.synthesis.spoken[1].onend();
  assert.deepEqual(await playback.promise, { status: "completed", voice: "browser" });
  assert.deepEqual(log, ["started", "browser", chunkA, chunkB, "final"]);
});

test("after the cooldown the network is tried again and success clears the state", async () => {
  const h = harness();
  await failOnce(h);
  h.clock.value += NETWORK_VOICE_COOLDOWN_MS;
  const before = h.requests.length;
  const playback = playInterviewerSegments([chunkA], h.options);
  await flush();
  assert.equal(h.requests.length, before + 1);
  h.pending.get(chunkA).ok();
  await flush();
  h.audios[0].emit("playing");
  h.audios[0].emit("ended");
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.equal(shouldSkipNetworkVoice(h.clock.value), false);
});

test("a failure after the cooldown re-arms it", async () => {
  const h = harness();
  await failOnce(h);
  h.clock.value += NETWORK_VOICE_COOLDOWN_MS;
  h.synthesis.spoken.length = 0;
  const playback = playInterviewerSegments([chunkA], h.options);
  await flush();
  h.pending.get(chunkA).status(500);
  await flush();
  h.synthesis.spoken[0].onstart();
  h.synthesis.spoken[0].onend();
  await playback.promise;
  assert.equal(shouldSkipNetworkVoice(h.clock.value + 1), true);
});

test("prewarm is a no-op during the cooldown", async () => {
  const h = harness();
  markNetworkVoiceFailed(h.clock.value);
  const prewarm = prewarmInterviewerSpeech([chunkA], h.options);
  assert.equal(await prewarm.promise, false);
  assert.equal(h.requests.length, 0);
});

test("an already prepared utterance is still played from the network during the cooldown", async () => {
  const h = harness();
  const fetcher = async (_endpoint, init) => ({ ok: true, blob: async () => new Blob([JSON.parse(init.body).text]) });
  assert.equal(await prewarmInterviewerSpeech([chunkA], { endpoint: "/speech", fetcher, retainMs: 5_000, setTimeout: () => 1, clearTimeout() {} }).promise, true);
  markNetworkVoiceFailed(h.clock.value);
  const playback = playInterviewerSegments([chunkA], h.options);
  await flush();
  assert.equal(h.audios.length, 1);
  h.audios[0].emit("playing");
  h.audios[0].emit("ended");
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.equal(h.synthesis.spoken.length, 0);
});

test("a request that misses the 4 s deadline but later succeeds does not arm the cooldown and its audio is never played", async () => {
  const h = harness();
  const playback = playInterviewerSegments([chunkA, chunkB], h.options);
  await flush();
  h.fireDeadline();
  await flush();
  assert.equal(h.requests.length, 1, "the slow request is not aborted and no further chunk is requested");
  h.synthesis.spoken[0].onstart();
  h.pending.get(chunkA).ok();
  await flush();
  assert.equal(shouldSkipNetworkVoice(h.clock.value), false, "healthy: no cooldown");
  assert.equal(h.audios.length, 0, "late audio is discarded, never played");
  h.synthesis.spoken[0].onend();
  h.synthesis.spoken[1].onstart();
  h.synthesis.spoken[1].onend();
  assert.deepEqual(await playback.promise, { status: "completed", voice: "browser" });
  assert.equal(h.audios.length, 0);
  assert.equal(h.requests.length, 1);
});

test("a request that misses the deadline and then fails arms the cooldown", async () => {
  const h = harness();
  const playback = playInterviewerSegments([chunkA], h.options);
  await flush();
  h.fireDeadline();
  await flush();
  assert.equal(shouldSkipNetworkVoice(h.clock.value), false, "still unknown while the request is in flight");
  h.pending.get(chunkA).status(500);
  await flush();
  assert.equal(shouldSkipNetworkVoice(h.clock.value), true);
  h.synthesis.spoken[0].onstart();
  h.synthesis.spoken[0].onend();
  assert.deepEqual(await playback.promise, { status: "completed", voice: "browser" });
});

test("a background request that never answers is bounded by its own timeout and arms the cooldown", async () => {
  const h = harness();
  const playback = playInterviewerSegments([chunkA], { ...h.options, backgroundRequestTimeoutMs: 7_000 });
  await flush();
  h.fireDeadline();
  await flush();
  const [id, timer] = [...h.timers].find(([, entry]) => entry.delay === 7_000);
  h.timers.delete(id);
  timer.callback();
  await flush();
  assert.equal(shouldSkipNetworkVoice(h.clock.value), true);
  playback.cancel();
});

test("a slow success learned in the background clears an earlier cooldown", async () => {
  const h = harness();
  const playback = playInterviewerSegments([chunkA], h.options);
  await flush();
  h.fireDeadline();
  await flush();
  markNetworkVoiceFailed(h.clock.value);
  h.pending.get(chunkA).ok();
  await flush();
  assert.equal(shouldSkipNetworkVoice(h.clock.value), false);
  playback.cancel();
});

test("a 401 does not arm the cooldown", async () => {
  const h = harness();
  const playback = playInterviewerSegments([chunkA], h.options);
  await flush();
  h.pending.get(chunkA).status(401);
  const result = await playback.promise;
  assert.equal(result.status, "unavailable");
  assert.equal(h.synthesis.spoken.length, 0);
  assert.equal(shouldSkipNetworkVoice(h.clock.value), false);
});

test("without a browser voice the cooldown keeps today's network behavior", async () => {
  const h = harness({ browser: false });
  markNetworkVoiceFailed(h.clock.value);
  const playback = playInterviewerSegments([chunkA], h.options);
  await flush();
  assert.equal(h.requests.length, 1);
  playback.cancel();
});

test("the audio test (synthesizeInterviewerQuestion) skips the network during the cooldown and arms it on a stall", async () => {
  const h = harness();
  const first = synthesizeInterviewerQuestion(chunkA, h.options);
  await flush();
  h.fireDeadline();
  await flush();
  h.synthesis.spoken[0].onstart();
  h.synthesis.spoken[0].onend();
  assert.deepEqual(await first.promise, { status: "completed", voice: "browser" });
  assert.equal(shouldSkipNetworkVoice(h.clock.value), true);
  const before = h.requests.length;
  const second = synthesizeInterviewerQuestion(chunkA, h.options);
  await flush();
  assert.equal(h.requests.length, before);
  h.synthesis.spoken[1].onstart();
  h.synthesis.spoken[1].onend();
  assert.deepEqual(await second.promise, { status: "completed", voice: "browser" });
});
