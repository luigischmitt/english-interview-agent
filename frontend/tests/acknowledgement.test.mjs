import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { ACKNOWLEDGEMENT_PHRASES, createAcknowledgementPlayer, pickAcknowledgement, stripLeadingAcknowledgement } from "../src/lib/interview/acknowledgement.mjs";
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
  assert.equal(stripLeadingAcknowledgement("Thanks for sharing that. What happened next?"), "Thanks for sharing that. What happened next?");
  assert.equal(stripLeadingAcknowledgement("That makes sense. What happened next?"), "That makes sense. What happened next?");
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
