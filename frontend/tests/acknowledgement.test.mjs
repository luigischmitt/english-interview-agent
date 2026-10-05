import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { ACKNOWLEDGEMENT_PHRASES, createAcknowledgementPlayer, isAcknowledgeableAnswer, pickAcknowledgement, stripLeadingAcknowledgement } from "../src/lib/interview/acknowledgement.mjs";
import { clearRetainedSpeechBlobs, playInterviewerSegments, resetSpeechFlights } from "../src/lib/interview/speech-playback.mjs";
import { createSpeechFeed } from "../src/components/interview/toucan/toucan-engine.mjs";

beforeEach(() => { resetSpeechFlights(); clearRetainedSpeechBlobs(); });

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("the acknowledgement rotates through the phrases without repeating the last one", () => {
  const played = [];
  let lastPhrase = null;
  for (let index = 0; index < 7; index += 1) {
    lastPhrase = pickAcknowledgement({ lastPhrase });
    played.push(lastPhrase);
  }
  assert.deepEqual(played, [...ACKNOWLEDGEMENT_PHRASES, ACKNOWLEDGEMENT_PHRASES[0], ACKNOWLEDGEMENT_PHRASES[1]]);
  for (let index = 1; index < played.length; index += 1) assert.notEqual(played[index], played[index - 1]);
});

test("the acknowledgement skips families the interviewer used in a recent bridge and phrases with no audio", () => {
  assert.equal(pickAcknowledgement({ recent: ["Okay, thanks for that."] }), "Got it.", "Okay is recent");
  assert.equal(pickAcknowledgement({ recent: ["OK.", "Got it."] }), "Alright.");
  assert.equal(pickAcknowledgement({ lastPhrase: "Got it.", recent: ["Alright, great."] }), "Mm-hm, okay.");
  assert.equal(pickAcknowledgement({ available: ["Thanks."], recent: ["Thank you."] }), "Thanks.", "falls back rather than staying silent");
  assert.equal(pickAcknowledgement({ available: ["Alright.", "Thanks."], lastPhrase: "Alright." }), "Thanks.");
  assert.equal(pickAcknowledgement({ available: [] }), null);
  assert.equal(pickAcknowledgement({ available: ["Okay."], lastPhrase: "Okay." }), "Okay.", "a single phrase may repeat");
});

test("a bridge loses only a leading pure acknowledgement, never a phrase that carries meaning", () => {
  assert.equal(stripLeadingAcknowledgement("Okay. Tell me about a hard bug."), "Tell me about a hard bug.");
  assert.equal(stripLeadingAcknowledgement("Okay, so what was the hardest part?"), "So what was the hardest part?");
  assert.equal(stripLeadingAcknowledgement("Got it, thanks. Why Redis?"), "Why Redis?");
  assert.equal(stripLeadingAcknowledgement("Great — and how did you test it?"), "And how did you test it?");
  assert.equal(stripLeadingAcknowledgement("Mm-hm, okay. Next question."), "Next question.");
  assert.equal(stripLeadingAcknowledgement("Thanks for sharing that. What happened next?"), "What happened next?");
  assert.equal(stripLeadingAcknowledgement("That makes sense. What happened next?"), "What happened next?");
  assert.equal(stripLeadingAcknowledgement("Thanks for that. Let's move on. Can you describe the design?"), "Can you describe the design?");
  assert.equal(stripLeadingAcknowledgement("Thank you for the example. Why Redis?"), "Why Redis?");
  assert.equal(stripLeadingAcknowledgement("Okay, thanks for sharing this. Why Redis?"), "Why Redis?");
  assert.equal(stripLeadingAcknowledgement("Thanks for explaining the retry logic, how do you test it?"), "Thanks for explaining the retry logic, how do you test it?", "content stays");
  assert.equal(stripLeadingAcknowledgement("That makes sense because of latency. What next?"), "That makes sense because of latency. What next?");
  assert.equal(stripLeadingAcknowledgement("Thanks for sharing that. That makes sense."), "");
  assert.equal(stripLeadingAcknowledgement("Okay."), "");
  assert.equal(stripLeadingAcknowledgement(""), "");
  assert.equal(stripLeadingAcknowledgement(null), "");
  assert.equal(stripLeadingAcknowledgement("Right now we use Kafka. Why?"), "Right now we use Kafka. Why?");
});

function fakeElement() {
  return {
    listeners: {}, paused: true, ended: false, currentTime: 0, plays: 0, released: false,
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener() {}, removeAttribute() {}, load() {},
    pause() { this.paused = true; },
    play() { this.paused = false; this.plays += 1; return Promise.resolve(); },
  };
}

function playerHarness(extra = {}) {
  const audios = []; const chunks = []; const urls = []; const revoked = []; const loaded = [];
  const player = createAcknowledgementPlayer({
    loadBlob: async (phrase) => { loaded.push(phrase); return new Blob([phrase]); },
    makeAudio: () => { const audio = fakeElement(); audios.push(audio); return audio; },
    createObjectUrl: (blob) => { const url = `blob:${blob.size}:${urls.length}`; urls.push(url); return url; },
    revokeObjectUrl: (url) => revoked.push(url),
    setTimeout: () => 1, clearTimeout: () => {},
    onChunkAudio: (chunk) => chunks.push(chunk),
    ...extra,
  });
  return { player, audios, chunks, urls, revoked, loaded };
}

test("preload synthesizes every phrase once, one at a time, and a failing phrase is simply never picked", async () => {
  const { player } = playerHarness({ loadBlob: async (phrase) => { if (phrase === "Alright.") throw new Error("down"); return new Blob([phrase]); } });
  await Promise.all([player.preload(), player.preload()]);
  assert.equal(player.loadedCount, ACKNOWLEDGEMENT_PHRASES.length - 1);
  assert.equal(player.play()?.phrase !== "Alright.", true);
});

test("nothing plays before the audio is loaded", () => {
  const { player, audios } = playerHarness();
  assert.equal(player.play(), null);
  assert.equal(audios.length, 0);
});

test("play starts the stored audio at once, feeds the avatar like a speech chunk and releases everything when it ends", async () => {
  const { player, audios, chunks, revoked } = playerHarness();
  await player.preload();
  const handle = player.play({ recent: [] });
  assert.equal(handle.phrase, "Okay.");
  assert.equal(audios.length, 1);
  assert.equal(audios[0].plays, 1, "play() is called synchronously: no network, no waiting");
  assert.equal(chunks.length, 1);
  assert.deepEqual([chunks[0].chunkIndex, chunks[0].chunkCount, chunks[0].endsWithQuestion], [0, 1, false]);
  assert.ok(chunks[0].blob instanceof Blob);
  assert.equal(chunks[0].isPlaying(), true);
  audios[0].currentTime = 0.4;
  assert.equal(chunks[0].clock(), 0.4);
  assert.equal(player.playing, true);
  assert.equal(player.play(), null, "never doubles up while one is audible");

  audios[0].listeners.ended();
  await handle.promise;
  assert.equal(player.playing, false);
  assert.equal(chunks[0].isPlaying(), false);
  assert.equal(revoked.length, 1);
  await player.whenIdle();

  const next = player.play({ recent: [] });
  assert.equal(next.phrase, "Got it.", "rotates; no repeat");
  next.cancel();
});

test("the avatar's speech feed accepts the acknowledgement chunk like any speech chunk", async () => {
  const feed = createSpeechFeed({ decode: async () => ({ getChannelData: () => new Float32Array(2205), sampleRate: 22_050 }) });
  const { player } = playerHarness({ onChunkAudio: feed.push });
  await player.preload();
  const handle = player.play();
  await tick();
  assert.equal(feed.size, 1);
  assert.ok(feed.sample(0), "the beak has a playing chunk to follow");
  handle.cancel();
});

test("an autoplay-blocked play() ends the acknowledgement silently", async () => {
  const diagnostics = [];
  const { player } = playerHarness({
    makeAudio: () => ({ ...fakeElement(), play: () => Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" })) }),
    onDiagnostic: (event) => diagnostics.push(event.kind),
  });
  await player.preload();
  const handle = player.play();
  await handle.promise;
  assert.equal(player.playing, false);
  assert.ok(diagnostics.includes("ack_play_failed"));
});

test("a safety timer ends an acknowledgement whose audio never reports ended", async () => {
  const timers = [];
  const { player } = playerHarness({ setTimeout: (callback) => { timers.push(callback); return timers.length; } });
  await player.preload();
  const handle = player.play();
  assert.equal(player.playing, true);
  timers[0]();
  await handle.promise;
  assert.equal(player.playing, false);
});

test("the real speech waits for an acknowledgement that is still audible, then plays", async () => {
  const log = []; const audios = [];
  let finishAck;
  const gate = new Promise((resolve) => { finishAck = resolve; });
  const playback = playInterviewerSegments(["Tell me about a hard bug."], {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: async (_endpoint, init) => ({ ok: true, blob: async () => new Blob([JSON.parse(init.body).text]) }),
    createObjectUrl: () => "blob:x", revokeObjectUrl: () => {},
    makeAudio: () => { const audio = fakeElement(); const play = audio.play.bind(audio); audio.play = () => { log.push("speech-play"); return play(); }; audios.push(audio); return audio; },
    setTimeout: () => 1, clearTimeout: () => {},
    beforePlayback: () => gate,
  });
  await tick(); await tick();
  assert.deepEqual(log, [], "audio arrived but waits for the acknowledgement");
  finishAck();
  await tick(); await tick();
  assert.deepEqual(log, ["speech-play"]);
  audios[0].listeners.ended();
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
});

test("cancelling while the acknowledgement is still playing never starts the speech", async () => {
  const log = [];
  const playback = playInterviewerSegments(["Tell me about a hard bug."], {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: async (_endpoint, init) => ({ ok: true, blob: async () => new Blob([JSON.parse(init.body).text]) }),
    createObjectUrl: () => "blob:x", revokeObjectUrl: () => {},
    makeAudio: () => { const audio = fakeElement(); audio.play = () => { log.push("speech-play"); return Promise.resolve(); }; return audio; },
    setTimeout: () => 1, clearTimeout: () => {},
    beforePlayback: () => new Promise(() => {}),
  });
  await tick(); await tick();
  playback.cancel();
  assert.deepEqual(await playback.promise, { status: "cancelled" });
  assert.deepEqual(log, []);
});

test("only answers with enough words are acknowledged", () => {
  assert.equal(isAcknowledgeableAnswer("yes"), false);
  assert.equal(isAcknowledgeableAnswer("I don't know"), false);
  assert.equal(isAcknowledgeableAnswer("We moved the service to Kubernetes last year"), true);
  assert.equal(isAcknowledgeableAnswer(null), false);
});

function timedHarness(extra = {}) {
  const timers = new Map(); let nextId = 1; let clock = 1_000; const diagnostics = [];
  const base = playerHarness({
    leadMs: 450, gapMs: 300,
    now: () => clock,
    setTimeout: (callback, delay) => { const id = nextId++; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    onDiagnostic: (event) => diagnostics.push(event),
    ...extra,
  });
  const fire = (delay) => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); clock += delay; timer.callback(); } };
  return { ...base, timers, diagnostics, fire, advance: (ms) => { clock += ms; } };
}

test("a scheduled acknowledgement waits a natural beat before it speaks", async () => {
  const { player, audios, timers, fire, diagnostics } = timedHarness();
  await player.preload();
  const handle = player.schedule();
  assert.ok(handle);
  assert.equal(audios.length, 0, "nothing audible at the moment the answer is final");
  assert.equal(player.busy, true);
  assert.equal([...timers.values()][0].delay, 450);
  fire(450);
  assert.equal(audios.length, 1);
  assert.equal(diagnostics.find((event) => event.kind === "ack_play").answerToAckMs, 450);
  audios[0].listeners.ended();
  await handle.promise;
  assert.equal(diagnostics.some((event) => event.kind === "ack_ended" && typeof event.ackDurationMs === "number"), true);
});

test("cancelling during the beat means the acknowledgement never speaks and the gate opens", async () => {
  const { player, audios } = timedHarness();
  await player.preload();
  player.schedule();
  const gate = player.beforeQuestion();
  player.cancel();
  await gate;
  assert.equal(audios.length, 0);
  assert.equal(player.busy, false);
});

test("the question gate covers the beat, the acknowledgement and a short gap, in that order", async () => {
  const { player, audios, fire, diagnostics } = timedHarness();
  await player.preload();
  player.schedule();
  let opened = false;
  const gate = player.beforeQuestion().then(() => { opened = true; });
  await tick();
  assert.equal(opened, false, "decision ready before the beat ends: the question still waits");
  fire(450);
  audios[0].listeners.ended();
  await tick(); await tick();
  assert.equal(opened, false, "the gap after the acknowledgement");
  fire(300);
  await gate;
  assert.equal(opened, true);
  const gap = diagnostics.find((event) => event.kind === "ack_question_gap");
  assert.equal(gap.ackToQuestionMs, 300);
  assert.equal(diagnostics.some((event) => event.kind === "ack_overlap"), false);
});

test("a turn without an acknowledgement is not delayed", async () => {
  const { player } = timedHarness();
  await player.preload();
  await player.beforeQuestion();
});

test("an acknowledgement that would start after the question began is skipped", async () => {
  const { player, audios } = timedHarness();
  await player.preload();
  await player.beforeQuestion();
  assert.equal(player.play(), null);
  assert.equal(audios.length, 0);
});

test("scheduling is skipped when audio is not loaded or the answer no longer applies", async () => {
  const unloaded = timedHarness();
  assert.equal(unloaded.player.schedule(), null);
  const { player, audios, fire, diagnostics } = timedHarness();
  await player.preload();
  const handle = player.schedule({ shouldPlay: () => false });
  fire(450);
  await handle.promise;
  assert.equal(audios.length, 0);
  assert.deepEqual(diagnostics.filter((event) => event.kind === "ack_skipped").map((event) => event.reason), ["not_applicable"]);
  assert.equal(player.schedule() !== null, true, "a new turn schedules again");
});
