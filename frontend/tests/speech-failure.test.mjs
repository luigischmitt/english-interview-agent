import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  FIRST_AUDIO_TIMEOUT_MS,
  clearRetainedSpeechBlobs,
  playInterviewerSegments,
  prewarmInterviewerSpeech,
  resetSpeechFlights,
  speechUnavailableMessage,
  synthesizeInterviewerQuestion,
} from "../src/lib/interview/speech-playback.mjs";

beforeEach(() => { resetSpeechFlights(); clearRetainedSpeechBlobs(); });

const flush = () => new Promise((resolve) => setImmediate(resolve));
const chunkA = "Thanks for that answer about caching.";
const chunkB = "How did you invalidate entries across regions?";
const chunkC = "And what happened during a regional failover?";

class FakeAudio {
  constructor(log, id) { this.log = log; this.id = id; this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  removeAttribute() {}
  load() {}
  pause() {}
  play() { this.log.push(`play:${this.id}`); return Promise.resolve(); }
  emit(type) { this.listeners.get(type)?.(); }
}

function harness() {
  const log = [];
  const pending = new Map();
  const audios = [];
  const timers = new Map();
  let timerId = 0;
  const fetcher = (_endpoint, init) => new Promise((resolve, reject) => {
    const text = JSON.parse(init.body).text;
    init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    pending.set(text, {
      ok: () => resolve({ ok: true, blob: async () => new Blob([text]) }),
      fail: () => resolve({ ok: false, status: 502, json: async () => ({ error: { message: "The speech provider is unavailable." } }) }),
    });
  });
  const options = {
    endpoint: "/speech", fetcher,
    makeAudio: (url) => { const audio = new FakeAudio(log, url); audios.push(audio); return audio; },
    createObjectUrl: (blob) => `blob:${blob.size}`,
    revokeObjectUrl: () => {},
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    onSegment: (segment) => log.push(`caption:${segment}`),
    onPlaybackStarted: () => log.push("playback-started"),
    onFinalChunkStarted: () => log.push("final-chunk"),
  };
  const fireDeadline = () => {
    const [id, timer] = [...timers].find(([, entry]) => entry.delay === FIRST_AUDIO_TIMEOUT_MS);
    timers.delete(id);
    timer.callback();
  };
  return { log, pending, audios, timers, options, fireDeadline };
}

test("the wait for interviewer audio is 20 seconds, within the backend budget plus transfer", () => assert.equal(FIRST_AUDIO_TIMEOUT_MS, 20_000));

test("the failure message is Portuguese, tells the candidate to read and answer, and hides provider details", () => {
  assert.match(speechUnavailableMessage, /Leia a pergunta e responda normalmente/u);
  assert.ok(!/provider|speech|error/iu.test(speechUnavailableMessage));
});

test("a hanging first chunk ends as unavailable at the deadline instead of waiting forever", async () => {
  const { log, audios, options, fireDeadline } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB], options);
  await flush();
  fireDeadline();
  assert.deepEqual(await playback.promise, { status: "unavailable", message: speechUnavailableMessage });
  assert.deepEqual(log, [], "nothing was played or captioned by a second voice");
  assert.equal(audios.length, 0);
});

test("a failed request resolves unavailable right away, without waiting for the deadline", async () => {
  const { pending, options } = harness();
  const playback = playInterviewerSegments(["One sentence that is long enough."], options);
  await flush();
  pending.get("One sentence that is long enough.").fail();
  const result = await playback.promise;
  assert.deepEqual(result, { status: "unavailable", message: speechUnavailableMessage });
  assert.ok(!/provider/u.test(result.message));
});

test("a chunk that stalls after chunk 1 played ends the utterance as unavailable and never plays late audio", async () => {
  const { log, pending, audios, options, fireDeadline } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB, chunkC], options);
  await flush();
  pending.get(chunkA).ok();
  await flush();
  audios[0].emit("playing");
  audios[0].emit("ended");
  await flush();
  fireDeadline();
  assert.deepEqual(await playback.promise, { status: "unavailable", message: speechUnavailableMessage });
  assert.equal(log.filter((entry) => entry === "playback-started").length, 1);
  pending.get(chunkB)?.ok();
  await flush();
  assert.equal(audios.length, 1, "late audio is ignored");
});

test("cancelling a stalled utterance resolves cancelled", async () => {
  const { options } = harness();
  const playback = playInterviewerSegments([chunkA], options);
  await flush();
  playback.cancel();
  assert.deepEqual(await playback.promise, { status: "cancelled" });
});

test("a session rejection keeps its own message instead of the generic voice message", async () => {
  const options = {
    endpoint: "/speech",
    fetcher: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Sua sessão expirou. Entre novamente." } }) }),
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  assert.deepEqual(await playInterviewerSegments([chunkA], options).promise, { status: "unavailable", message: "Sua sessão expirou. Entre novamente." });
});

test("retrying the same utterance after a failure requests the speech again and plays it", async () => {
  const { pending, audios, options } = harness();
  const first = playInterviewerSegments([chunkA], options);
  await flush();
  pending.get(chunkA).fail();
  assert.equal((await first.promise).status, "unavailable");

  pending.clear();
  const retry = playInterviewerSegments([chunkA], options);
  await flush();
  assert.ok(pending.has(chunkA), "a new request is made for the retry");
  pending.get(chunkA).ok();
  await flush();
  audios[0].emit("playing");
  audios[0].emit("ended");
  assert.deepEqual(await retry.promise, { status: "completed", voice: "network" });
});

test("a prewarmed utterance still plays over the network", async () => {
  const { log, audios, options } = harness();
  const fetcher = async (_endpoint, init) => ({ ok: true, blob: async () => new Blob([JSON.parse(init.body).text]) });
  const prewarm = prewarmInterviewerSpeech([chunkA], { endpoint: "/speech", fetcher, retainMs: 5_000, setTimeout: () => 1, clearTimeout() {} });
  assert.equal(await prewarm.promise, true);
  const playback = playInterviewerSegments([chunkA], { ...options, fetcher: () => new Promise(() => {}) });
  await flush();
  assert.equal(audios.length, 1);
  audios[0].emit("playing");
  audios[0].emit("ended");
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.ok(log.includes("playback-started"));
});

test("prewarm is no longer skipped after a failed utterance", async () => {
  const { pending, options } = harness();
  const failed = playInterviewerSegments([chunkA], options);
  await flush();
  pending.get(chunkA).fail();
  await failed.promise;
  let requested = 0;
  const fetcher = async () => { requested += 1; return { ok: true, blob: async () => new Blob(["x"]) }; };
  const prewarm = prewarmInterviewerSpeech([chunkB], { endpoint: "/speech", fetcher, setTimeout: () => 1, clearTimeout() {} });
  assert.equal(await prewarm.promise, true);
  assert.equal(requested, 1);
});

test("the setup audio test also ends as unavailable (no browser voice) when synthesis hangs", async () => {
  const { options, fireDeadline } = harness();
  const playback = synthesizeInterviewerQuestion("Hello, thanks for joining me today.", options);
  await flush();
  fireDeadline();
  assert.deepEqual(await playback.promise, { status: "unavailable", message: speechUnavailableMessage });
});
