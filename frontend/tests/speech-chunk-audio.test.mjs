import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { clearRetainedSpeechBlobs, playInterviewerSegments, resetSpeechFlights } from "../src/lib/interview/speech-playback.mjs";
import { createWebAudioTrack, resetPlaybackContext } from "../src/lib/interview/web-audio-playback.mjs";
import { createSpeechFeed } from "../src/components/interview/toucan/toucan-engine.mjs";

beforeEach(() => { resetSpeechFlights(); clearRetainedSpeechBlobs(); resetPlaybackContext(); });

const tick = () => new Promise((resolve) => setImmediate(resolve));

function fakeElement(log) {
  const audio = {
    listeners: {}, paused: true, ended: false, currentTime: 0, preload: "none",
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener() {},
    removeAttribute() {}, load() {},
    pause() { this.paused = true; },
    play() { this.paused = false; log.push("play"); return new Promise(() => {}); },
  };
  return audio;
}

const baseOptions = (audios, extra = {}) => ({
  endpoint: "http://speech.test/api/v1/speech",
  fetcher: async (_e, init) => ({ ok: true, blob: async () => new Blob([JSON.parse(init.body).text]) }),
  createObjectUrl: () => "blob:x", revokeObjectUrl: () => {},
  makeAudio: () => { const a = fakeElement([]); audios.push(a); return a; },
  setTimeout: () => 1, clearTimeout: () => {},
  ...extra,
});

test("onChunkAudio gets each chunk's blob, position clock and playing flag without changing playback", async () => {
  const audios = []; const chunks = [];
  const playback = playInterviewerSegments(["Tell me about a hard bug you fixed recently, please."], baseOptions(audios, { onChunkAudio: (c) => chunks.push(c) }));
  await tick(); await tick(); await tick();
  assert.equal(chunks.length, 1);
  const [chunk] = chunks;
  assert.equal(chunk.chunkIndex, 0);
  assert.equal(chunk.endsWithQuestion, false);
  assert.ok(chunk.blob instanceof Blob);
  assert.equal(chunk.decodeAudio, undefined, "pooled elements are decoded from the blob");
  // The element started: the chunk is playing and the clock follows currentTime.
  assert.equal(audios[0].paused, false);
  audios[0].currentTime = 1.25;
  assert.equal(chunk.isPlaying(), true);
  assert.equal(chunk.clock(), 1.25);
  audios[0].ended = true;
  assert.equal(chunk.isPlaying(), false);
  audios[0].ended = false;
  playback.cancel();
  assert.deepEqual(await playback.promise, { status: "cancelled" });
  assert.equal(chunk.isPlaying(), false, "a cancelled chunk is not playing; the pooled element may be reused");
  assert.equal(chunk.clock(), 0);
});

test("a throwing observer never breaks playback; endsWithQuestion flags a question", async () => {
  const audios = [];
  const playback = playInterviewerSegments(["Why Redis?"], baseOptions(audios, {
    makeAudio: () => { const a = fakeElement([]); a.play = () => { a.listeners.ended(); return Promise.resolve(); }; audios.push(a); return a; },
    onChunkAudio: () => { throw new Error("boom"); },
  }));
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  const seen = [];
  const second = playInterviewerSegments(["Why Redis?"], baseOptions(audios, {
    makeAudio: () => { const a = fakeElement([]); a.play = () => { a.listeners.ended(); return Promise.resolve(); }; return a; },
    onChunkAudio: (c) => seen.push(c.endsWithQuestion),
  }));
  await second.promise;
  assert.deepEqual(seen, [true]);
});

test("on the Web Audio path the chunk reuses the track's decoded buffer (no second decode)", async () => {
  let decodes = 0;
  const buffer = { duration: 1, sampleRate: 22_050, getChannelData: () => new Float32Array(22_050) };
  const context = {
    state: "running", currentTime: 0, destination: {},
    addEventListener() {}, removeEventListener() {}, resume: () => Promise.resolve(),
    createBufferSource: () => ({ connect() {}, disconnect() {}, start() {}, stop() {}, onended: null }),
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    decodeAudioData: () => { decodes += 1; return Promise.resolve(buffer); },
  };
  const chunks = [];
  const playback = playInterviewerSegments(["Tell me about it."], {
    ...baseOptions([], { onChunkAudio: (c) => chunks.push(c) }),
    makeAudio: (url) => createWebAudioTrack(url, { context, fetchArrayBuffer: async () => new ArrayBuffer(8), setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} }),
  });
  await tick(); await tick(); await tick(); await tick();
  assert.equal(chunks.length, 1);
  assert.equal(typeof chunks[0].decodeAudio, "function");

  const feed = createSpeechFeed({ decode: async () => { throw new Error("must not decode the blob"); } });
  feed.push(chunks[0]);
  await tick(); await tick();
  assert.equal(decodes, 1);
  assert.equal(chunks[0].isPlaying(), true);
  const sample = feed.sample(0);
  assert.ok(sample?.features, "the envelope was computed from the track's buffer");
  playback.cancel();
});

test("the speech feed analyses a blob, picks the playing chunk and falls back when decoding fails", async () => {
  const pcm = new Float32Array(22_050);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / 22_050);
  let playing = true; let clock = 0.5;
  const feed = createSpeechFeed({ decode: async () => ({ sampleRate: 22_050, getChannelData: () => pcm }) });
  feed.push({ chunkIndex: 0, blob: new Blob(["x"]), clock: () => clock, isPlaying: () => playing });
  assert.equal(feed.sample(0).features, null, "still analysing: callers use the generic motion");
  await tick(); await tick();
  const s = feed.sample(0.1);
  assert.ok(s.features && s.pos >= 0.5);
  playing = false;
  assert.equal(feed.sample(0.2), null);
  assert.equal(feed.size, 0, "a chunk that finished playing is dropped");

  const failing = createSpeechFeed({ decode: async () => { throw new Error("EncodingError"); } });
  failing.push({ chunkIndex: 0, blob: new Blob(["x"]), clock: () => 0, isPlaying: () => true });
  await tick(); await tick();
  assert.equal(failing.sample(0).failed, true);
  // A new utterance (chunk 0) forgets everything left over from the previous one.
  failing.push({ chunkIndex: 1, blob: new Blob(["x"]), clock: () => 0, isPlaying: () => false });
  failing.push({ chunkIndex: 0, blob: new Blob(["x"]), clock: () => 0, isPlaying: () => false });
  assert.equal(failing.size, 1);
});
