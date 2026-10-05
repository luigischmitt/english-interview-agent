import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { resetSpeechFlights } from "../src/lib/interview/speech-playback.mjs";
import { clearRetainedSpeechBlobs, groupInterviewerSentences, playInterviewerSegments, prewarmInterviewerSpeech, splitInterviewerSpeech as splitSentences } from "../src/lib/interview/speech-playback.mjs";

beforeEach(() => { resetSpeechFlights(); });

const texts = (segments) => groupInterviewerSentences(segments).map((chunk) => chunk.text);

const question = "Now I'd like to hear how you approach designing scalable systems. How would you design a service that sends notifications to millions of users?";
const roleOpening = "We have about 5 minutes for your junior Software Engineer role. Can you tell me about your experience and what makes you a strong fit for Software Engineer?";

test("production examples: the first sentence is the short first chunk and the second sentence is one whole chunk", () => {
  assert.deepEqual(texts(splitSentences(question)), [
    "Now I'd like to hear how you approach designing scalable systems.",
    "How would you design a service that sends notifications to millions of users?",
  ]);
  assert.deepEqual(texts(splitSentences(roleOpening)), [
    "We have about 5 minutes for your junior Software Engineer role.",
    "Can you tell me about your experience and what makes you a strong fit for Software Engineer?",
  ]);
});

test("short sentences stay in one request; a whole utterance of at most 50 characters is one chunk", () => {
  assert.deepEqual(texts(["Hi.", "Yes."]), ["Hi. Yes."]);
  assert.deepEqual(texts(["Got it.", "Why Redis?"]), ["Got it. Why Redis?"]);
  assert.deepEqual(texts([]), []);
  assert.deepEqual(texts(["  ", ""]), []);
});

test("a first sentence of at most 70 characters is the first chunk; later short sentences merge into whole-sentence chunks", () => {
  const redis = "Why did you choose Redis for the session cache at scale?";
  const scale = "How did it scale to many more users at peak?";
  assert.deepEqual(texts([redis, "Thanks.", scale]), [redis, `Thanks. ${scale}`]);
  // A bridge shorter than 25 characters absorbs the next sentence, so no chunk is tiny.
  assert.deepEqual(texts(["Thanks.", redis, scale]), [`Thanks. ${redis}`, scale]);
  // A short trailing sentence joins the previous chunk.
  assert.deepEqual(texts([redis, "Tell me about a hard bug you fixed.", "Ok?"]), [redis, "Tell me about a hard bug you fixed. Ok?"]);
});

test("a first sentence over 70 characters is cut at its first clause break of at least 25 characters", () => {
  const grouped = groupInterviewerSentences(["Thanks for joining me today and for taking the time to talk, because I want to hear about your work.", "Tell me about a hard bug you fixed recently."]);
  assert.deepEqual(grouped.map((chunk) => chunk.text), [
    "Thanks for joining me today and for taking the time to talk,",
    "because I want to hear about your work. Tell me about a hard bug you fixed recently.",
  ]);
  // A clause break before 25 characters is skipped: "Hi," is too short, so the cut is at the next comma.
  assert.equal(texts(["Hi, thanks for joining me today and for taking the time to talk about your work, ok?", "Great, tell me about your last project."])[0], "Hi, thanks for joining me today and for taking the time to talk about your work,");
  assert.deepEqual(texts(["Let us begin with your background \u2014 especially the systems you owned end to end at work in production."]), [
    "Let us begin with your background", "especially the systems you owned end to end at work in production.",
  ]);
  assert.deepEqual(texts(["Here is the plan for today: we start with a short warm up and then go deeper into system design."]), [
    "Here is the plan for today:", "we start with a short warm up and then go deeper into system design.",
  ]);
});

test("a long first sentence without punctuation stays whole rather than being cut mid-phrase", () => {
  const long = "Could you walk me through how you designed the retry policy for the payment webhooks in production?";
  assert.equal(texts([long, "Then tell me what you changed afterwards."])[0], long);
  const blob = "x".repeat(90);
  assert.deepEqual(texts([blob]), [blob]);
});

test("after the first chunk, chunks end only at sentence ends and merge up to 180 characters", () => {
  const first = "Welcome to the interview today.";
  const a = "Walk me through a system you owned end to end at your last company.";
  const b = "Which part of it was the hardest?";
  const c = "How did your team measure whether the redesign actually worked?";
  assert.deepEqual(texts([first, a, b, c]), [first, a, `${b} ${c}`]);
  assert.ok(texts([first, a, b, c]).slice(1).every((chunk) => /[.?!]$/.test(chunk)));
  const words = (n) => `${"word ".repeat(n).trim()}.`; // 5 * n characters
  assert.deepEqual(texts([first, words(20), words(20)]), [first, words(20), words(20)], "two 100-character sentences stay separate chunks");
  assert.ok(texts([first, words(6), words(8), words(10), "Hm."]).slice(1).every((text) => text.length <= 180));
  assert.ok(texts([first, words(6), words(8), words(10), "Hm."]).every((text) => text.length >= 25));
});

const twoHundred = "We migrated the billing service to a new cluster last year because deploys were slow and risky, so the team agreed to move it gradually while keeping the old path running and then we measured the results every week.";

test("a single sentence over 180 characters is split at a clause break", () => {
  assert.ok(twoHundred.length > 200);
  const chunks = texts(["Thanks for that answer.", twoHundred]);
  assert.equal(chunks[0], "Thanks for that answer.");
  const pieces = chunks.slice(1);
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every((piece) => piece.length <= 180 && piece.length >= 25), JSON.stringify(pieces));
  assert.equal(pieces.join(" "), twoHundred);
  assert.ok(/,$/.test(pieces[0]), "the cut falls on a clause break");
  const words = `${"word ".repeat(45).trim()}.`; // 225 characters, no boundary
  const wordPieces = texts(["Hello there friend, welcome.", words]).slice(1);
  assert.ok(wordPieces.length >= 2 && wordPieces.every((piece) => piece.length <= 180 && piece.length >= 25));
  assert.equal(wordPieces.join(" "), words);
  const blob = "x".repeat(250);
  assert.deepEqual(texts(["Hello there friend, welcome.", blob]), ["Hello there friend, welcome.", blob], "no usable space: stays whole");
});

test("captions stay whole sentences for every piece of a split sentence", () => {
  const sentence = "Thanks for joining me today and for taking the time to talk, because I want to hear about your work.";
  const next = "Tell me about a hard bug you fixed recently.";
  const grouped = groupInterviewerSentences([sentence, next]);
  assert.deepEqual(grouped[0].sentences, [sentence]);
  assert.deepEqual(grouped[1].sentences, [sentence, next], "the remainder of the split sentence merges with the next one");
  assert.deepEqual(grouped.flatMap((chunk) => chunk.units.map((unit) => unit.caption)), [sentence, sentence, next]);
  const long = groupInterviewerSentences(["Thanks for that answer.", twoHundred]);
  for (const chunk of long.slice(1)) assert.deepEqual(chunk.sentences, [twoHundred]);
});

test("prewarm requests the same pieces as playback", async () => {
  const segments = ["Thanks for that answer.", twoHundred];
  const grouped = groupInterviewerSentences(segments);
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
const chunkA = "Thanks for that answer about caching.";
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

test("only chunk 1 is requested first; the rest start once it arrives, and the next audio is preloaded", async () => {
  const { log, pending, audios, options } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB, chunkC], options);
  await flush();
  assert.deepEqual(log, [`fetch:${chunkA}`], "chunk 1 is synthesized alone");

  pending.get(chunkA)();
  await flush();
  assert.deepEqual(log.slice(1), [`fetch:${chunkB}`, `fetch:${chunkC}`, `caption:${chunkA}`, `play:blob:${chunkA.length}`], "the rest start together once chunk 1 arrived");
  assert.equal(audios.length, 1);

  pending.get(chunkB)();
  await flush();
  assert.equal(audios.length, 2, "chunk 2 audio is preloaded while chunk 1 plays");

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

test("after chunk 1 arrives at most three chunk requests are in flight; a finished one releases the next", async () => {
  const { log, pending, options } = harness();
  const sentences = [
    "One sentence that is surely long enough.", "Two sentences that are surely long enough, and then some more words.",
    "Three sentences that are surely long enough, and then some more words.", "Four sentences that are surely long enough, and then some more words.",
    "Five sentences that are surely long enough, and then some more words.",
  ];
  const chunks = groupInterviewerSentences(sentences).map((chunk) => chunk.text);
  assert.ok(chunks.length >= 5);
  playInterviewerSegments(sentences, options);
  await flush();
  const fetches = () => log.filter((entry) => entry.startsWith("fetch:")).map((entry) => entry.slice(6));
  assert.deepEqual(fetches(), chunks.slice(0, 1), "only chunk 1 first");
  pending.get(chunks[0])();
  await flush();
  assert.deepEqual(fetches(), chunks.slice(0, 4), "chunk 1 plus three more in flight");
  pending.get(chunks[3])();
  await flush();
  assert.deepEqual(fetches(), chunks.slice(0, 5), "any completion frees a slot, in order");
  pending.get(chunks[1])();
  pending.get(chunks[2])();
  await flush();
  assert.deepEqual(fetches(), chunks, "every chunk is eventually requested");
});

test("playback order is preserved when later chunks resolve first", async () => {
  const { log, pending, audios, options } = harness();
  const playback = playInterviewerSegments([chunkA, chunkB, chunkC], options);
  await flush();
  assert.deepEqual(log, [`fetch:${chunkA}`]);
  pending.get(chunkA)();
  await flush();
  pending.get(chunkC)();
  pending.get(chunkB)();
  await flush();
  assert.deepEqual(log.filter((entry) => entry.startsWith("play:")), [`play:blob:${chunkA.length}`]);
  audios[0].emit("ended");
  await flush();
  audios[1].emit("ended");
  await flush();
  audios[2].emit("ended");
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.deepEqual(log.filter((entry) => entry.startsWith("play:")), [chunkA, chunkB, chunkC].map((text) => `play:blob:${text.length}`));
  assert.deepEqual(log.filter((entry) => entry.startsWith("caption:")), [chunkA, chunkB, chunkC].map((text) => `caption:${text}`));
});

test("a split first sentence plays as separate requests but is captioned as the whole sentence", async () => {
  const { log, pending, audios, options } = harness();
  const sentence = "Thanks for joining me today and for taking the time to talk, because I want to hear about your work.";
  const head = "Thanks for joining me today and for taking the time to talk,";
  const tail = "because I want to hear about your work.";
  const playback = playInterviewerSegments([sentence], options);
  await flush();
  assert.deepEqual(log, [`fetch:${head}`]);
  pending.get(head)();
  await flush();
  assert.ok(log.includes(`fetch:${tail}`), "the tail is requested once the head arrived");
  assert.ok(log.includes(`caption:${sentence}`));
  audios[0].emit("ended");
  await flush();
  pending.get(tail)();
  await flush();
  audios[1].emit("ended");
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.deepEqual(log.filter((entry) => entry.startsWith("caption:")), [`caption:${sentence}`, `caption:${sentence}`], "second part still shows the whole sentence");
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
  assert.deepEqual(aborted, [chunkB, chunkC], "chunks 2 and 3 were in flight");
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
  assert.deepEqual(calls, [chunkA, chunkB], "in playback order");
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
  const segments = splitSentences(question);
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

test("prewarm requests chunk 1 alone, then the rest three at a time", async () => {
  clearRetainedSpeechBlobs();
  const { log, pending, options } = harness();
  const sentences = [
    "One sentence that is surely long enough.", "Two sentences that are surely long enough, and then some more words.",
    "Three sentences that are surely long enough, and then some more words.", "Four sentences that are surely long enough, and then some more words.",
  ];
  const chunks = groupInterviewerSentences(sentences).map((chunk) => chunk.text);
  const prewarm = prewarmInterviewerSpeech(sentences, { ...options, retainMs: 5_000 });
  await flush();
  assert.deepEqual(log, [`fetch:${chunks[0]}`]);
  pending.get(chunks[0])();
  await flush();
  assert.equal(log.length, 4, "three more start once chunk 1 arrived");
  for (const text of chunks) pending.get(text)?.();
  assert.equal(await prewarm.promise, true);
  clearRetainedSpeechBlobs();
});
