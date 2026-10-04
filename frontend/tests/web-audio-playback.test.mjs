import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { acquireInterviewerAudio, resetSharedAudioPool } from "../src/lib/interview/audio-unlock.mjs";
import { createWebAudioTrack, resetPlaybackContext, shouldUseWebAudio, unlockPlaybackContext } from "../src/lib/interview/web-audio-playback.mjs";
import { clearRetainedSpeechBlobs, playInterviewerSegments, resetSpeechFlights, synthesizeInterviewerQuestion } from "../src/lib/interview/speech-playback.mjs";

beforeEach(() => { resetSpeechFlights(); clearRetainedSpeechBlobs(); resetSharedAudioPool(); resetPlaybackContext(); });

const tick = () => new Promise((resolve) => setImmediate(resolve));

class FakeSource {
  constructor(context) { this.context = context; this.onended = null; this.started = false; this.stopped = false; this.connected = null; }
  connect(node) { this.connected = node; }
  disconnect() {}
  start() { this.started = true; this.context.sources.push(this); }
  stop() { this.stopped = true; }
  finish() { this.onended?.(); }
}

class FakeContext {
  constructor({ state = "running", decodeDuration = 2 } = {}) {
    this.state = state;
    this.currentTime = 0;
    this.sources = [];
    this.destination = { name: "destination" };
    this.decodeDuration = decodeDuration;
    this.decoded = [];
    this.resumeCalls = 0;
    this.listeners = new Set();
  }
  addEventListener(_type, listener) { this.listeners.add(listener); }
  removeEventListener(_type, listener) { this.listeners.delete(listener); }
  resume() { this.resumeCalls += 1; return Promise.resolve(); }
  createBufferSource() { return new FakeSource(this); }
  createBuffer(channels, length, rate) { return { channels, length, rate, duration: length / rate }; }
  createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
  decodeAudioData(bytes) {
    this.decoded.push(bytes);
    return Promise.resolve({ duration: this.decodeDuration });
  }
  setState(state) { this.state = state; for (const listener of [...this.listeners]) listener(); }
}

const trackDeps = (context, extra = {}) => ({
  context,
  fetchArrayBuffer: async (url) => new TextEncoder().encode(url).buffer,
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
  ...extra,
});

test("the Web Audio path is chosen for iOS only", () => {
  const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 };
  const ipadDesktopMode = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 };
  const mac = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 };
  const android = { userAgent: "Mozilla/5.0 (Linux; Android 14)", platform: "Linux armv8l", maxTouchPoints: 5 };
  assert.equal(shouldUseWebAudio(iphone, true), true);
  assert.equal(shouldUseWebAudio(ipadDesktopMode, true), true);
  assert.equal(shouldUseWebAudio(mac, true), false);
  assert.equal(shouldUseWebAudio(android, true), false);
  assert.equal(shouldUseWebAudio(iphone, false), false, "no AudioContext, no Web Audio path");
});

test("desktop keeps the pooled HTMLAudioElement path", () => {
  // Node has no navigator.userAgent of an iPhone: the shared pool (an Audio constructor) is used.
  const created = [];
  globalThis.Audio = class { constructor() { created.push(this); } };
  try {
    const audio = acquireInterviewerAudio("blob:desktop");
    assert.equal(audio.src, "blob:desktop");
    assert.equal(created.length, 1);
  } finally {
    delete globalThis.Audio;
  }
});

test("a track decodes, plays through an AudioBufferSourceNode and reports playing then ended", async () => {
  const context = new FakeContext({ decodeDuration: 3 });
  const track = createWebAudioTrack("blob:a", trackDeps(context));
  const seen = [];
  track.addEventListener("playing", () => seen.push("playing"));
  track.addEventListener("ended", () => seen.push("ended"));
  assert.equal(track.paused, true);
  await track.play();
  assert.deepEqual(seen, ["playing"]);
  assert.equal(track.paused, false);
  assert.equal(track.duration, 3);
  assert.equal(context.decoded.length, 1);
  context.currentTime = 1.5;
  assert.equal(track.currentTime, 1.5);
  context.sources[0].finish();
  assert.deepEqual(seen, ["playing", "ended"]);
  assert.equal(track.currentTime, 3);
});

test("preload decodes ahead and play reuses the decoded buffer", async () => {
  const context = new FakeContext();
  const track = createWebAudioTrack("blob:b", trackDeps(context));
  track.preload = "auto";
  await tick();
  await track.play();
  assert.equal(context.decoded.length, 1, "decoded once");
});

test("pause and dispose stop the source without firing ended", async () => {
  const context = new FakeContext();
  const track = createWebAudioTrack("blob:c", trackDeps(context));
  let ended = 0;
  track.addEventListener("ended", () => { ended += 1; });
  await track.play();
  const source = context.sources[0];
  track.dispose();
  assert.equal(source.stopped, true);
  source.finish();
  assert.equal(ended, 0);
  await assert.rejects(track.play(), { name: "InvalidStateError" });
});

test("a context that never runs rejects play with NotAllowedError (autoplay blocked)", async () => {
  const context = new FakeContext({ state: "suspended" });
  const track = createWebAudioTrack("blob:d", trackDeps(context, { setTimeout: (callback) => { setImmediate(callback); return 1; } }));
  await assert.rejects(track.play(), { name: "NotAllowedError" });
  assert.ok(context.resumeCalls >= 1);
  assert.equal(context.sources.length, 0);
});

test("a context that resumes during play still plays", async () => {
  const context = new FakeContext({ state: "suspended" });
  const track = createWebAudioTrack("blob:e", trackDeps(context));
  const playing = track.play();
  await tick();
  context.setState("running");
  await playing;
  assert.equal(context.sources[0].started, true);
});

test("undecodable audio emits error and rejects with EncodingError", async () => {
  const context = new FakeContext();
  context.decodeAudioData = () => Promise.reject(new Error("bad data"));
  const track = createWebAudioTrack("blob:f", trackDeps(context));
  let errors = 0;
  track.addEventListener("error", () => { errors += 1; });
  await assert.rejects(track.play(), { name: "EncodingError" });
  assert.equal(errors, 1);
});

test("unlockPlaybackContext resumes the shared context and starts a silent sample", () => {
  const context = new FakeContext({ state: "suspended" });
  assert.equal(unlockPlaybackContext({ create: () => context }), "suspended");
  assert.equal(context.resumeCalls, 1);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].started, true);
});

const webAudioOptions = (context, fetched, extra = {}) => ({
  endpoint: "http://speech.test/api/v1/speech",
  fetcher: async (_endpoint, init) => { fetched.push(JSON.parse(init.body).text); return { ok: true, blob: async () => new Blob(["mp3"]) }; },
  makeAudio: (url) => createWebAudioTrack(url, trackDeps(context)),
  createObjectUrl: () => `blob:${fetched.length}`,
  revokeObjectUrl: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
  ...extra,
});

test("chunks play in order through Web Audio, advancing on each source's ended, with timing callbacks", async () => {
  const context = new FakeContext();
  const fetched = [];
  const events = [];
  const diagnostics = [];
  const segments = ["I led the migration of our billing platform to services.", "Afterwards we reduced the deployment time by half overall."];
  const playback = playInterviewerSegments(segments, webAudioOptions(context, fetched, {
    onSynthesisStarted: () => events.push("synthesis-started"),
    onSynthesisCompleted: () => events.push("synthesis-completed"),
    onPlaybackStarted: () => events.push("playback-started"),
    onFinalChunkStarted: () => events.push("final-chunk-started"),
    onDiagnostic: (event) => diagnostics.push(event),
  }));
  for (let attempt = 0; attempt < 20 && context.sources.length < 1; attempt += 1) await tick();
  assert.equal(context.sources.length, 1, "only the first chunk is playing");
  assert.deepEqual(events.slice(0, 3), ["synthesis-started", "synthesis-completed", "playback-started"]);
  context.sources[0].finish();
  for (let attempt = 0; attempt < 20 && context.sources.length < 2; attempt += 1) await tick();
  assert.equal(context.sources.length, 2, "ended starts the next chunk");
  assert.ok(events.includes("final-chunk-started"));
  context.sources[1].finish();
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.equal(fetched.length, 2);
  const kinds = diagnostics.map((event) => `${event.chunkIndex}:${event.kind}`);
  assert.deepEqual(kinds.filter((kind) => !kind.endsWith("play_resolved")), ["0:playback_start", "0:playback_playing", "0:playback_ended", "1:playback_start", "1:playback_playing", "1:playback_ended"]);
  assert.ok(diagnostics.every((event) => event.output === "webaudio" && event.pooled === false));
});

test("cancelling during Web Audio playback stops the source and resolves cancelled", async () => {
  const context = new FakeContext();
  const fetched = [];
  const playback = playInterviewerSegments(["I led the migration of our billing platform to services."], webAudioOptions(context, fetched));
  for (let attempt = 0; attempt < 20 && context.sources.length < 1; attempt += 1) await tick();
  playback.cancel();
  assert.deepEqual(await playback.promise, { status: "cancelled" });
  assert.equal(context.sources[0].stopped, true);
});

test("a blocked context ends the utterance as unavailable with the autoplay reason", async () => {
  const context = new FakeContext({ state: "suspended" });
  const fetched = [];
  const playback = synthesizeInterviewerQuestion("Hello there.", webAudioOptions(context, fetched, {
    makeAudio: (url) => createWebAudioTrack(url, trackDeps(context, { setTimeout: (callback) => { setImmediate(callback); return 1; } })),
  }));
  const result = await playback.promise;
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "autoplay_blocked");
});
