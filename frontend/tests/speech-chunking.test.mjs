import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { resetSpeechFlights } from "../src/lib/interview/speech-playback.mjs";
import { clearRetainedSpeechBlobs, groupInterviewerSentences, playInterviewerSegments, prewarmInterviewerSpeech } from "../src/lib/interview/speech-playback.mjs";

beforeEach(() => { resetSpeechFlights(); });

const texts = (segments) => groupInterviewerSentences(segments).map((chunk) => chunk.text);

test("the first sentence is its own chunk, later short sentences merge with the next one, a sentence is never split", () => {
  // 55 characters: a first sentence of at most 60 characters is never split.
  const redis = "Why did you choose Redis for the session cache at scale?";
  assert.deepEqual(texts(["Thanks.", redis, "How did it scale to many more users at peak?"]), ["Thanks.", redis, "How did it scale to many more users at peak?"]);
  assert.deepEqual(texts([redis, "Thanks.", "How did it scale to many more users at peak?"]), [redis, "Thanks. How did it scale to many more users at peak?"]);
  assert.deepEqual(texts(["Hi.", "Yes."]), ["Hi. Yes."]);
  assert.deepEqual(texts([]), []);
  assert.deepEqual(texts(["  ", ""]), []);
});

test("a short first sentence stays whole; a short trailing sentence joins the previous chunk", () => {
  const long = "Could you walk me through how you designed the retry policy for the payment webhooks in production?";
  const second = "Next one is surely long enough to stand alone.";
  // The long first sentence now splits at a word boundary (see below); its 39-character remainder plus the second sentence
  // would be 86 characters, over the 80 cap, so they stay separate chunks.
  assert.deepEqual(texts([long, second]), ["Could you walk me through how you designed the retry policy", "for the payment webhooks in production?", second]);
  assert.deepEqual(texts([second, "Tell me about a hard bug.", "Ok?"]), [second, "Tell me about a hard bug. Ok?"]);
  // A whole utterance of at most 70 characters stays a single request.
  assert.deepEqual(texts(["Got it.", "Why Redis?"]), ["Got it. Why Redis?"]);
  const grouped = groupInterviewerSentences([second, "Next one is also long enough to stand alone."]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped[0].sentences, [second]);
});

const opening = "We have about 5 minutes for your senior backend role, focusing on technical depth.";

test("a first sentence over 60 characters is split at the first clause boundary leaving 20-60 characters", () => {
  const grouped = groupInterviewerSentences([opening, "Tell me about a hard bug you fixed recently."]);
  assert.deepEqual(grouped.map((chunk) => chunk.text), [
    "We have about 5 minutes for your senior backend role,",
    "focusing on technical depth. Tell me about a hard bug you fixed recently.",
  ]);
  assert.ok(grouped[0].text.length >= 20 && grouped[0].text.length <= 60);
  // The remainder is not merged back into the first chunk, even when nothing follows it.
  assert.deepEqual(texts([opening]), ["We have about 5 minutes for your senior backend role,", "focusing on technical depth."]);
});

test("the split honours ; \u2014 and : and skips boundaries that leave a part under 20 characters", () => {
  // "Thanks for joining," is 19 characters, so the semicolon is the first boundary that leaves 20-60.
  assert.deepEqual(texts(["Thanks for joining, we start with recent work on it; then move to design."]), [
    "Thanks for joining, we start with recent work on it;", "then move to design.",
  ]);
  assert.deepEqual(texts(["Let us begin with your background \u2014 especially the systems you owned end to end at work."]), [
    "Let us begin with your background", "especially the systems you owned end to end at work.",
  ]);
  assert.deepEqual(texts(["Here is the plan for today: we start with a short warm up and then go deeper on design."]), [
    "Here is the plan for today:", "we start with a short warm up and then go deeper on design.",
  ]);
  // A clause boundary that leaves a head over 60 characters is not used: the sentence splits before a conjunction instead.
  const lateComma = "Hi, thanks for joining me today and for taking the time to talk about your work, ok?";
  assert.deepEqual(texts([lateComma]), ["Hi, thanks for joining me today and for taking the time", "to talk about your work, ok?"]);
  // A later sentence is split only when it is over 80 characters (this one is 84, so it splits at its comma).
  const later = ["Hello there and welcome to the interview.", "We have about 5 minutes for your senior backend role, focusing on technical depth."];
  assert.deepEqual(texts(later), ["Hello there and welcome to the interview.", "We have about 5 minutes for your senior backend role,", "focusing on technical depth."]);
  const mid = ["Hello there and welcome to the interview.", "We have five minutes for your backend role, focusing on depth."];
  assert.deepEqual(texts(mid), mid, "a later sentence of at most 80 characters is never split");
});

const bridge119 = "So you moved the billing service into a separate cluster for the payment team after deploys kept failing under heavy load.";

test("a long first sentence without a clause boundary splits before the latest conjunction leaving at most 60 characters", () => {
  assert.ok(bridge119.length >= 115);
  const [head, tail] = texts([bridge119]);
  // No clause boundary; " to " does not occur, " into " is not a boundary, so the word-boundary fallback applies.
  assert.equal(head, "So you moved the billing service into a separate cluster for");
  assert.ok(head.length >= 25 && head.length <= 60);
  assert.equal(`${head} ${tail}`, bridge119);
  assert.deepEqual(texts(["We rebuilt the cache layer last quarter because deploys kept failing under load."]), ["We rebuilt the cache layer last quarter", "because deploys kept failing under load."]);
});

test("without a clause or conjunction boundary the first sentence splits at the last space before 60 characters", () => {
  const long = "Could you walk me through how you designed the retry policy for the payment webhooks in production?";
  assert.deepEqual(texts([long]), ["Could you walk me through how you designed the retry policy", "for the payment webhooks in production?"]);
  assert.ok(texts([long])[0].length <= 60);
  // A single very long word run with no usable space stays whole.
  const blob = "x".repeat(90);
  assert.deepEqual(texts([blob]), [blob]);
});

test("a first sentence of at most 60 characters is untouched", () => {
  const exact = "Tell me about the hardest production incident you handled.";
  assert.ok(exact.length <= 60);
  assert.deepEqual(texts([exact, "Take your time and answer as you would in a real interview."]), [exact, "Take your time and answer as you would in a real interview."]);
});

test("captions stay whole sentences while the two parts of a split sentence play", () => {
  const grouped = groupInterviewerSentences([opening, "Tell me about a hard bug you fixed recently."]);
  assert.deepEqual(grouped[0].sentences, [opening]);
  assert.deepEqual(grouped[1].sentences, [opening, "Tell me about a hard bug you fixed recently."]);
});

test("a group never merges past 80 characters", () => {
  const words = (n) => `${"word ".repeat(n).trim()}.`; // 5 * n characters
  assert.deepEqual(texts(["Okay.", words(16)]), ["Okay.", words(16)], "a short sentence is not merged into one that would exceed the cap");
  assert.deepEqual(texts([words(8), words(16), "Ok?"]), [words(8), words(16), "Ok?"], "a short trailing sentence does not join a chunk that would exceed the cap");
  const [first, second] = [words(8), words(12)];
  assert.deepEqual(texts([first, second, "Hm."]), [first, `${second} Hm.`], "merging below the cap still happens");
  assert.ok(texts([words(10), words(10), words(10), "Hm."]).every((text) => text.length <= 80));
});

const twoHundred = "We migrated the billing service to a new cluster last year because deploys were slow and risky, so the team agreed to move it gradually while keeping the old path running and then we measured the results every week.";

test("a long later sentence is split into pieces of about 80 characters (up to 90 at clause and conjunction boundaries)", () => {
  assert.ok(twoHundred.length >= 200);
  const chunks = texts(["Thanks for that answer.", twoHundred]);
  assert.equal(chunks[0], "Thanks for that answer.");
  const pieces = chunks.slice(1);
  assert.ok(pieces.length >= 3);
  assert.ok(pieces.every((piece) => piece.length <= 90), JSON.stringify(pieces)); // natural boundaries may overshoot the 80 cap by up to 10
  assert.equal(pieces.join(" "), twoHundred);
  assert.ok(pieces.slice(1).every((piece) => /^(because|so|and|but|which|when|while|where|that|to)\b/.test(piece) || /[,;:]$/.test(pieces[pieces.indexOf(piece) - 1])), "cuts fall on clause or conjunction boundaries");
});

test("a long sentence with no boundary splits at the last space before 80 characters, recursively", () => {
  const words = `${"word ".repeat(45).trim()}.`; // 225 characters
  const pieces = texts(["Hello there."].concat(words)).slice(1);
  assert.ok(pieces.length >= 3);
  assert.ok(pieces.every((piece) => piece.length <= 80 && piece.length >= 25));
  assert.equal(pieces.join(" "), words);
  const blob = "x".repeat(120);
  assert.deepEqual(texts(["Hello there.", blob]), ["Hello there.", blob], "no usable space: stays whole");
});

test("every piece of a split sentence is captioned with the whole sentence, and prewarm requests the same pieces", async () => {
  const segments = ["Thanks for that answer.", twoHundred];
  const grouped = groupInterviewerSentences(segments);
  assert.deepEqual(grouped[0].sentences, ["Thanks for that answer."]);
  for (const chunk of grouped.slice(1)) assert.deepEqual(chunk.sentences, [twoHundred]);
  clearRetainedSpeechBlobs();
  const calls = [];
  const fetcher = async (_endpoint, init) => { calls.push(JSON.parse(init.body).text); return { ok: true, blob: async () => new Blob([init.body]) }; };
  assert.equal(await prewarmInterviewerSpeech(segments, { endpoint: "/speech", fetcher, retainMs: 5_000 }).promise, true);
  assert.deepEqual(calls, grouped.map((chunk) => chunk.text));
  clearRetainedSpeechBlobs();
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

test("chunks are requested one at a time: chunk N+1 only once chunk N has arrived, and chunk 1 plays on arrival", async () => {
  const { log, pending, audios, options } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB, chunkC], options);
  await flush();
  assert.deepEqual(log, [`fetch:${chunkA}`], "only chunk 1 is requested up front");

  pending.get(chunkA)();
  await flush();
  assert.deepEqual(log.slice(1), [`fetch:${chunkB}`, `caption:${chunkA}`, `play:blob:${chunkA.length}`], "chunk 2 is requested as chunk 1 arrives, while it plays");
  assert.equal(audios.length, 1);

  pending.get(chunkB)();
  await flush();
  assert.equal(audios.length, 2, "chunk 2 audio is preloaded while chunk 1 plays");
  assert.ok(log.includes(`fetch:${chunkC}`), "chunk 3 is requested once chunk 2 arrived");
  assert.equal(log.filter((entry) => entry.startsWith("fetch:")).length, 3);

  audios[0].emit("ended");
  await flush();
  assert.deepEqual(log.slice(-2), [`caption:${chunkB}`, `play:blob:${chunkB.length}`]);
  pending.get(chunkC)();
  audios[1].emit("ended");
  await flush();
  audios[2].emit("ended");
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.deepEqual(log.filter((entry) => entry.startsWith("play:")), [chunkA, chunkB, chunkC].map((text) => `play:blob:${text.length}`));
});

test("at most one chunk request is in flight at a time", async () => {
  const { log, pending, options } = harness();
  const sentences = ["One sentence that is surely long enough.", "Two sentences that are surely long enough.", "Three sentences that are surely long enough.", "Four sentences that are surely long enough."];
  playInterviewerSegments(sentences, options);
  await flush();
  const fetches = () => log.filter((entry) => entry.startsWith("fetch:")).length;
  assert.equal(fetches(), 1);
  for (let index = 0; index < 3; index += 1) {
    pending.get(sentences[index])();
    await flush();
    assert.equal(fetches(), index + 2);
  }
});

test("a split first sentence plays as two requests but is captioned as the whole sentence", async () => {
  const { log, pending, audios, options } = harness();
  const next = "Tell me about a hard bug you fixed recently.";
  const playback = playInterviewerSegments([opening, next], options);
  await flush();
  const head = "We have about 5 minutes for your senior backend role,";
  assert.deepEqual(log, [`fetch:${head}`]);
  pending.get(head)();
  await flush();
  assert.ok(log.includes(`caption:${opening}`));
  audios[0].emit("ended");
  await flush();
  pending.get(`focusing on technical depth. ${next}`)();
  await flush();
  audios[1].emit("ended");
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.deepEqual(log.filter((entry) => entry.startsWith("caption:")), [`caption:${opening}`, `caption:${opening}`], "second part still shows the whole sentence");
  assert.ok(!log.some((entry) => entry === "caption:focusing on technical depth." || entry === `caption:${head}`), "no partial caption");
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
  assert.deepEqual(aborted, [chunkB], "only chunk 2 was in flight; chunk 3 was never requested");
});

test("a failed later chunk ends as unavailable after the earlier chunk played, without hanging", async () => {
  const { pending, audios, options } = harness({ failText: chunkB });
  const playback = playInterviewerSegments([chunkA, chunkB], options);
  await flush();
  pending.get(chunkA)();
  await flush();
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
  assert.deepEqual(calls, [chunkA, chunkB], "sequential, in playback order");
  const { options } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB], { ...options, fetcher });
  await flush();
  assert.equal(calls.length, 2, "no extra requests");
  playback.cancel();
  await playback.promise;
  clearRetainedSpeechBlobs();
});

test("prewarm and playback share the same chunks, including a split first sentence", async () => {
  clearRetainedSpeechBlobs();
  const calls = [];
  const fetcher = async (_endpoint, init) => { calls.push(JSON.parse(init.body).text); return { ok: true, blob: async () => new Blob([init.body]) }; };
  const segments = [opening, "Tell me about a hard bug you fixed recently."];
  assert.equal(await prewarmInterviewerSpeech(segments, { endpoint: "/speech", fetcher, retainMs: 5_000 }).promise, true);
  assert.deepEqual(calls, groupInterviewerSentences(segments).map((chunk) => chunk.text));
  const { options } = harness();
  const playback = playInterviewerSegments(segments, { ...options, fetcher });
  await flush();
  assert.equal(calls.length, 2, "no extra requests");
  playback.cancel();
  await playback.promise;
  clearRetainedSpeechBlobs();
});

test("prewarm requests chunk N+1 only after chunk N arrived", async () => {
  clearRetainedSpeechBlobs();
  const { log, pending, options } = harness();
  const prewarm = prewarmInterviewerSpeech([chunkA, chunkB], { ...options, retainMs: 5_000 });
  await flush();
  assert.deepEqual(log, [`fetch:${chunkA}`]);
  pending.get(chunkA)();
  await flush();
  assert.deepEqual(log, [`fetch:${chunkA}`, `fetch:${chunkB}`]);
  pending.get(chunkB)();
  assert.equal(await prewarm.promise, true);
  clearRetainedSpeechBlobs();
});
