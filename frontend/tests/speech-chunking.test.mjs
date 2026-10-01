import assert from "node:assert/strict";
import test from "node:test";
import { clearRetainedSpeechBlobs, groupInterviewerSentences, playInterviewerSegments, prewarmInterviewerSpeech } from "../src/lib/interview/speech-playback.mjs";

const texts = (segments) => groupInterviewerSentences(segments).map((chunk) => chunk.text);

test("short sentences merge with the next one and a sentence is never split", () => {
  const redis = "Why did you choose Redis for the session cache in that system?";
  assert.deepEqual(texts(["Thanks.", redis, "How did it scale to many more users at peak?"]), [`Thanks. ${redis}`, "How did it scale to many more users at peak?"]);
  assert.deepEqual(texts(["Hi.", "Yes."]), ["Hi. Yes."]);
  assert.deepEqual(texts([]), []);
  assert.deepEqual(texts(["  ", ""]), []);
});

test("a long single sentence stays whole and a short trailing sentence joins the previous chunk", () => {
  const long = "Could you walk me through how you designed the retry policy for the payment webhooks in production?";
  assert.deepEqual(texts([long]), [long]);
  const first = "We have about 5 minutes for your senior backend role, focusing on technical depth.";
  assert.deepEqual(texts([first, "Tell me about a hard bug.", "Ok?"]), [`${first} Tell me about a hard bug. Ok?`]);
  const grouped = groupInterviewerSentences([first, "Next one is surely long enough to stand alone."]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].sentences, [first]);
});

class FakeAudio {
  constructor(log, id) { this.log = log; this.id = id; this.listeners = new Map(); this.paused = false; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  removeAttribute() {}
  load() {}
  pause() { this.paused = true; }
  play() { this.log.push(`play:${this.id}`); return Promise.resolve(); }
  emit(type) { this.listeners.get(type)?.(); }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const chunkA = "Thanks for that detailed answer about caching.";
const chunkB = "How did you invalidate entries across regions?";
const chunkC = "And what happened during a regional failover?";

function harness({ failText = null } = {}) {
  const log = [];
  const pending = new Map();
  const audios = [];
  const aborted = [];
  const fetcher = (_endpoint, init) => new Promise((resolve, reject) => {
    const text = JSON.parse(init.body).text;
    log.push(`fetch:${text}`);
    init.signal.addEventListener("abort", () => { aborted.push(text); reject(new Error("aborted")); });
    pending.set(text, () => (text === failText ? resolve({ ok: false, json: async () => ({}) }) : resolve({ ok: true, blob: async () => new Blob([text]) })));
  });
  const options = {
    endpoint: "/speech", fetcher,
    makeAudio: (url) => { const audio = new FakeAudio(log, url); audios.push(audio); return audio; },
    createObjectUrl: (blob) => `blob:${blob.size}`,
    revokeObjectUrl: () => {},
    setTimeout: () => 1, clearTimeout: () => {},
    onSegment: (segment) => log.push(`caption:${segment}`),
  };
  return { log, pending, audios, aborted, options };
}

test("all chunks are requested immediately, chunk 1 plays on arrival and the rest follow in order", async () => {
  const { log, pending, audios, options } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB, chunkC], options);
  await flush();
  assert.deepEqual(log, [`fetch:${chunkA}`, `fetch:${chunkB}`, `fetch:${chunkC}`], "chunk 2 is requested before chunk 1 finishes");

  pending.get(chunkB)();
  await flush();
  assert.equal(audios.length, 0, "nothing plays before chunk 1 arrives");
  pending.get(chunkA)();
  await flush();
  assert.deepEqual(log.slice(3), [`caption:${chunkA}`, `play:blob:${chunkA.length}`]);
  assert.equal(audios.length, 2, "chunk 2 audio is preloaded while chunk 1 plays");

  audios[0].emit("ended");
  await flush();
  assert.deepEqual(log.slice(5), [`caption:${chunkB}`, `play:blob:${chunkB.length}`]);
  pending.get(chunkC)();
  audios[1].emit("ended");
  await flush();
  audios[2].emit("ended");
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.deepEqual(log.filter((entry) => entry.startsWith("play:")), [chunkA, chunkB, chunkC].map((text) => `play:blob:${text.length}`));
});

test("at most three chunk requests run at once", async () => {
  const { log, pending, options } = harness();
  const sentences = ["One sentence that is surely long enough.", "Two sentences that are surely long enough.", "Three sentences that are surely long enough.", "Four sentences that are surely long enough."];
  playInterviewerSegments(sentences, options);
  await flush();
  assert.equal(log.filter((entry) => entry.startsWith("fetch:")).length, 3);
  pending.get(sentences[0])();
  await flush();
  assert.equal(log.filter((entry) => entry.startsWith("fetch:")).length, 4);
});

test("cancelling stops the audio and aborts pending chunk requests", async () => {
  const { pending, audios, aborted, options } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB, chunkC], options);
  await flush();
  pending.get(chunkA)();
  await flush();
  playback.cancel();
  assert.deepEqual(await playback.promise, { status: "cancelled" });
  assert.equal(audios[0].paused, true);
  assert.deepEqual(aborted.sort(), [chunkB, chunkC].sort());
});

test("a failed later chunk ends as unavailable after the earlier chunk played, without hanging", async () => {
  const { pending, audios, options } = harness({ failText: chunkB });
  const playback = playInterviewerSegments([chunkA, chunkB], options);
  await flush();
  pending.get(chunkA)();
  pending.get(chunkB)();
  await flush();
  audios[0].emit("ended");
  const result = await playback.promise;
  assert.equal(result.status, "unavailable");
  assert.ok(result.message);
});

test("a failed first chunk is unavailable and nothing plays", async () => {
  const { pending, audios, options } = harness({ failText: chunkA });
  const playback = playInterviewerSegments([chunkA, chunkB], options);
  await flush();
  pending.get(chunkA)();
  assert.equal((await playback.promise).status, "unavailable");
  assert.equal(audios.length, 0);
});

test("prewarm requests the same chunks so playback reuses the blobs", async () => {
  clearRetainedSpeechBlobs();
  const calls = [];
  const fetcher = async (_endpoint, init) => { calls.push(JSON.parse(init.body).text); return { ok: true, blob: async () => new Blob([init.body]) }; };
  const prewarm = prewarmInterviewerSpeech([chunkA, chunkB], { endpoint: "/speech", fetcher, retainMs: 5_000 });
  assert.equal(await prewarm.promise, true);
  assert.deepEqual(calls, [chunkA, chunkB]);
  const { options } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB], { ...options, fetcher });
  await flush();
  assert.equal(calls.length, 2, "no extra requests");
  playback.cancel();
  await playback.promise;
  clearRetainedSpeechBlobs();
});
