import assert from "node:assert/strict";
import test from "node:test";
import { FIRST_AUDIO_FALLBACK_MS, clearRetainedSpeechBlobs, playInterviewerSegments, prewarmInterviewerSpeech, speechUnavailableMessage, synthesizeInterviewerQuestion } from "../src/lib/interview/speech-playback.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const chunkA = "Thanks for that detailed answer about caching.";
const chunkB = "How did you invalidate entries across regions?";
const chunkC = "And what happened during a regional failover?";

class FakeUtterance { constructor(text) { this.text = text; } }

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

function harness({ browser = true } = {}) {
  const log = [];
  const pending = new Map();
  const audios = [];
  const timers = new Map();
  let timerId = 0;
  const synthesis = { spoken: [], cancelled: 0, getVoices: () => [], speak: (utterance) => synthesis.spoken.push(utterance), cancel: () => { synthesis.cancelled += 1; } };
  const fetcher = (_endpoint, init) => new Promise((resolve, reject) => {
    const text = JSON.parse(init.body).text;
    init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    pending.set(text, { ok: () => resolve({ ok: true, blob: async () => new Blob([text]) }), fail: () => resolve({ ok: false, json: async () => ({ error: { message: "The speech provider is unavailable." } }) }) });
  });
  const options = {
    endpoint: "/speech", fetcher,
    makeAudio: (url) => { const audio = new FakeAudio(log, url); audios.push(audio); return audio; },
    createObjectUrl: (blob) => `blob:${blob.size}`,
    revokeObjectUrl: () => {},
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    browserVoice: browser ? { speechSynthesis: synthesis, makeUtterance: (text) => new FakeUtterance(text), voice: null } : { speechSynthesis: null },
    onSegment: (segment) => log.push(`caption:${segment}`),
    onPlaybackStarted: () => log.push("playback-started"),
    onFinalChunkStarted: () => log.push("final-chunk"),
    onBrowserVoiceStarted: () => log.push("browser-voice"),
  };
  const fireDeadline = () => {
    const [id, timer] = [...timers].find(([, entry]) => entry.delay === FIRST_AUDIO_FALLBACK_MS);
    timers.delete(id);
    timer.callback();
  };
  const speakNext = (index) => { const utterance = synthesis.spoken[index]; utterance.onstart(); return utterance; };
  return { log, pending, audios, timers, synthesis, options, fireDeadline, speakNext };
}

test("the fallback deadline is 4 seconds", () => assert.equal(FIRST_AUDIO_FALLBACK_MS, 4_000));

test("a hanging first chunk makes the browser voice speak the whole utterance with ordered callbacks", async () => {
  const { log, pending, audios, synthesis, options, fireDeadline, speakNext } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB], options);
  await flush();
  fireDeadline();
  await flush();
  assert.equal(synthesis.spoken.length, 1);
  assert.equal(synthesis.spoken[0].text, chunkA);
  speakNext(0);
  assert.deepEqual(log, ["playback-started", "browser-voice", `caption:${chunkA}`]);
  synthesis.spoken[0].onend();
  speakNext(1);
  synthesis.spoken[1].onend();
  assert.deepEqual(await playback.promise, { status: "completed", voice: "browser" });
  assert.deepEqual(log.slice(3), [`caption:${chunkB}`, "final-chunk"], "final-chunk fires when the last sentence starts");

  // Late network audio never produces a second voice.
  pending.get(chunkA).ok();
  await flush();
  assert.equal(audios.length, 0);
});

test("a failed request before the first chunk plays falls back right away, without waiting for the deadline", async () => {
  const { log, pending, synthesis, options } = harness();
  const playback = playInterviewerSegments(["One single sentence that is long enough to stand alone."], options);
  await flush();
  pending.get("One single sentence that is long enough to stand alone.").fail();
  await flush();
  assert.equal(synthesis.spoken.length, 1);
  synthesis.spoken[0].onstart();
  assert.deepEqual(log, ["playback-started", "browser-voice", "caption:One single sentence that is long enough to stand alone.", "final-chunk"], "a one-sentence utterance announces its final chunk at the start");
  synthesis.spoken[0].onend();
  assert.deepEqual(await playback.promise, { status: "completed", voice: "browser" });
});

test("a chunk that stalls after chunk 1 played hands only the remaining sentences to the browser voice", async () => {
  const { log, pending, audios, synthesis, options, fireDeadline } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB, chunkC], options);
  await flush();
  pending.get(chunkA).ok();
  await flush();
  audios[0].emit("playing");
  audios[0].emit("ended");
  await flush();
  assert.equal(synthesis.spoken.length, 0);
  fireDeadline();
  await flush();
  assert.deepEqual(synthesis.spoken.map((utterance) => utterance.text), [chunkB]);
  synthesis.spoken[0].onstart();
  synthesis.spoken[0].onend();
  synthesis.spoken[1].onstart();
  synthesis.spoken[1].onend();
  assert.deepEqual(await playback.promise, { status: "completed", voice: "browser" });
  assert.equal(log.filter((entry) => entry === "playback-started").length, 1, "playback-started fires once");
  assert.deepEqual(log.filter((entry) => entry === "final-chunk"), ["final-chunk"]);
  assert.ok(log.indexOf(`caption:${chunkC}`) < log.indexOf("final-chunk"));
  assert.ok(log.indexOf(`caption:${chunkB}`) > log.indexOf(`caption:${chunkA}`));
  // Chunk 3 arriving late does not play.
  pending.get(chunkC)?.ok();
  await flush();
  assert.equal(audios.length, 1);
});

test("cancelling during the browser voice stops speech and resolves cancelled", async () => {
  const { synthesis, options, fireDeadline } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB], options);
  await flush();
  fireDeadline();
  await flush();
  synthesis.spoken[0].onstart();
  playback.cancel();
  assert.equal(synthesis.cancelled, 1);
  assert.deepEqual(await playback.promise, { status: "cancelled" });
});

test("without a browser voice the stalled audio is unavailable at 4 s with a Portuguese message", async () => {
  const { options, fireDeadline } = harness({ browser: false });
  const playback = playInterviewerSegments([chunkA], options);
  await flush();
  fireDeadline();
  const result = await playback.promise;
  assert.deepEqual(result, { status: "unavailable", message: speechUnavailableMessage });
  assert.ok(!/provider/u.test(result.message));
});

test("a prewarmed utterance still plays over the network without any browser voice", async () => {
  clearRetainedSpeechBlobs();
  const { log, audios, synthesis, options } = harness();
  const fetcher = async (_endpoint, init) => ({ ok: true, blob: async () => new Blob([JSON.parse(init.body).text]) });
  const prewarm = prewarmInterviewerSpeech([chunkA], { endpoint: "/speech", fetcher, retainMs: 5_000, setTimeout: () => 1, clearTimeout() {} });
  assert.equal(await prewarm.promise, true);
  const playback = playInterviewerSegments([chunkA], { ...options, fetcher: () => new Promise(() => {}) });
  await flush();
  assert.equal(audios.length, 1);
  audios[0].emit("playing");
  audios[0].emit("ended");
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.equal(synthesis.spoken.length, 0);
  assert.ok(log.includes("playback-started"));
  clearRetainedSpeechBlobs();
});

test("the setup audio test speaks the phrase with the browser voice when synthesis hangs", async () => {
  clearRetainedSpeechBlobs();
  const { log, synthesis, options, fireDeadline } = harness();
  const playback = synthesizeInterviewerQuestion("Hello, thanks for joining me today.", options);
  await flush();
  fireDeadline();
  await flush();
  assert.equal(synthesis.spoken[0].text, "Hello, thanks for joining me today.");
  synthesis.spoken[0].onstart();
  synthesis.spoken[0].onend();
  assert.deepEqual(await playback.promise, { status: "completed", voice: "browser" });
  assert.ok(log.includes("browser-voice"));
  const cancelled = synthesizeInterviewerQuestion("Another phrase to say.", options);
  await flush();
  fireDeadline();
  await flush();
  cancelled.cancel();
  assert.deepEqual(await cancelled.promise, { status: "cancelled" });
});
