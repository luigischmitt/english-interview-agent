import assert from "node:assert/strict";
import test from "node:test";
import { playInterviewerSegments } from "../src/lib/interview/speech-playback.mjs";
import { createMicEngine } from "../src/lib/interview/mic-engine.mjs";
import { createAnswerStream } from "../src/lib/interview/answer-stream.mjs";
import { createListeningHandoffTiming } from "../src/lib/interview/handoff-timing.mjs";
import { createFakeMicDeps, FakeSocket, tick } from "./mic-fakes.mjs";

class FakeAudio {
  constructor() { this.listeners = {}; this.duration = NaN; this.currentTime = 0; this.paused = true; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  removeEventListener(type, listener) { if (this.listeners[type] === listener) delete this.listeners[type]; }
  removeAttribute() {}
  load() {}
  pause() { this.paused = true; }
  play() { this.paused = false; return Promise.resolve(); }
  fire(type) { this.listeners[type]?.(); }
}

const longSentence = (word) => `${word} is a sentence that is comfortably longer than forty characters.`;

/** The room + MicrophoneCapture wiring in miniature: engine, stream, and the playback events that drive them. */
async function scenario(segments) {
  const audios = [];
  const sockets = [];
  const deps = createFakeMicDeps();
  const engine = createMicEngine(deps);
  await engine.acquire();
  const worklet = deps.log.worklets[0];
  const stream = createAnswerStream({
    openSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
    buildStartMessage: async () => ({ type: "start", accessToken: "fresh", speechThreshold: engine.noiseFloor }),
    encodeFrame: (samples) => new Int16Array(samples.length).buffer,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  const log = [];
  const state = { ready: false, ended: false };
  const playback = playInterviewerSegments(segments, {
    endpoint: "http://speech.test/api/v1/speech",
    fetcher: async (_endpoint, init) => ({ ok: true, blob: async () => new Blob([JSON.parse(init.body).text]) }),
    createObjectUrl: () => "blob:x",
    revokeObjectUrl: () => {},
    makeAudio: () => { const audio = new FakeAudio(); audios.push(audio); return audio; },
    setTimeout: () => 1,
    clearTimeout: () => {},
    onPlaybackStarted: () => { log.push("playback-started"); engine.beginInterviewerSpeech(); },
    onFinalChunkStarted: () => { log.push("final-chunk"); stream.connect().catch(() => {}); },
  });
  const completed = playback.promise.then((result) => {
    if (result.status !== "completed") return;
    state.ended = true;
    log.push("playback-ended");
    // Answer window: gate first, then frames flow from this instant.
    stream.begin().then(() => log.push("listening"));
    engine.startCapture((frame) => stream.pushFrame(frame));
  });
  return { audios, sockets, deps, engine, worklet, stream, playback, completed, log, state };
}

test("multi-chunk utterance: socket opens when the final chunk is about to end; audio starts at playback end", async () => {
  const s = await scenario([longSentence("First"), longSentence("Second")]);
  await tick();
  const [first] = s.audios;
  first.duration = 4;
  first.fire("playing");
  assert.deepEqual(s.log, ["playback-started"], "chunk 1 is not the final chunk");
  first.fire("ended");
  await tick();
  assert.equal(s.sockets.length, 0);

  const second = s.audios[1];
  second.duration = 10;
  second.fire("playing");
  second.currentTime = 2;
  second.fire("timeupdate");
  assert.equal(s.sockets.length, 0, "8 s remain: too early to pre-connect");
  second.currentTime = 7.2;
  second.fire("timeupdate");
  second.fire("timeupdate"); // announced only once
  assert.deepEqual(s.log, ["playback-started", "final-chunk"]);
  await tick();
  assert.equal(s.sockets.length, 1);
  s.sockets[0].open();
  s.sockets[0].serverSays({ type: "ready" });
  await tick();
  assert.equal(s.stream.state, "ready");

  // The interviewer is still audible: microphone frames are discarded and nothing is sent.
  s.worklet.frame(0.3);
  s.worklet.frame(0.3);
  assert.deepEqual(s.sockets[0].messageTypes(), ["start"]);

  second.currentTime = 10;
  second.fire("ended");
  await s.completed;
  await tick();
  assert.deepEqual(s.log.slice(-2), ["playback-ended", "listening"]);
  assert.equal(s.stream.state, "streaming", "streaming starts in the same tick as the playback end");
  s.worklet.frame(0.2);
  assert.deepEqual(s.sockets[0].messageTypes(), ["start", "level"]);
  assert.equal(s.sockets[0].audioFrames().length, 1);
  assert.equal(s.sockets.length, 1);
});

test("a short single-chunk utterance pre-connects as soon as its playback starts", async () => {
  const s = await scenario(["Tell me about yourself."]);
  await tick();
  const [only] = s.audios;
  only.duration = 2.5;
  only.fire("playing");
  assert.deepEqual(s.log, ["playback-started", "final-chunk"]);
  only.fire("ended");
  await s.completed;
});

test("a long single-chunk utterance waits until three seconds remain", async () => {
  const s = await scenario([longSentence("Only")]);
  await tick();
  const [only] = s.audios;
  only.duration = 9;
  only.fire("playing");
  assert.deepEqual(s.log, ["playback-started"]);
  only.currentTime = 6.5;
  only.fire("timeupdate");
  assert.deepEqual(s.log, ["playback-started", "final-chunk"]);
  only.fire("ended");
  await s.completed;
});

test("when the socket is not ready at playback end only post-playback frames are kept, in order", async () => {
  const s = await scenario(["Tell me about yourself."]);
  await tick();
  const [only] = s.audios;
  only.duration = 2;
  only.fire("playing");
  await tick();
  s.sockets[0].open(); // connected but the server has not said ready yet
  s.worklet.frame(0.9); // interviewer audible: discarded
  only.fire("ended");
  await s.completed;
  assert.equal(s.stream.state, "connecting");
  s.worklet.frame(0.1);
  s.worklet.frame(0.2);
  assert.deepEqual(s.sockets[0].messageTypes(), ["start"]);
  s.sockets[0].serverSays({ type: "ready" });
  await tick();
  const levels = s.sockets[0].json().filter((message) => message.type === "level").map((message) => Number(message.value.toFixed(1)));
  assert.deepEqual(levels, [0.1, 0.2]);
  assert.equal(s.log.includes("listening"), true);
});

test("cancelling before playback ends closes the pre-opened socket with cancel and no audio was sent", async () => {
  const s = await scenario(["Tell me about yourself."]);
  await tick();
  const [only] = s.audios;
  only.duration = 2;
  only.fire("playing");
  await tick();
  s.sockets[0].open();
  s.sockets[0].serverSays({ type: "ready" });
  await tick();
  s.worklet.frame(0.4);
  s.playback.cancel(); // the user skipped, ended or left
  s.stream.cancel();
  assert.deepEqual(s.sockets[0].messageTypes(), ["start", "cancel"]);
  assert.equal(s.sockets[0].closed, true);
  assert.equal(s.sockets[0].audioFrames().length, 0);
  assert.equal(s.state.ended, false);
  assert.equal(s.engine.capturing, false);
});

test("the playback-ended to listening metric is content-free and near zero when pre-connected", () => {
  let clock = 1_000;
  const metrics = [];
  const timing = createListeningHandoffTiming({ now: () => clock, onComplete: (value) => metrics.push(value) });
  timing.markListening({ preconnected: true }); // nothing marked yet: ignored
  timing.markPlaybackEnded();
  clock += 3.4;
  timing.markListening({ preconnected: true });
  timing.markListening({ preconnected: true });
  clock = 5_000;
  timing.markPlaybackEnded();
  clock = 5_900;
  timing.markListening();
  assert.deepEqual(metrics, [
    { playbackEndedToListeningMs: 3, preconnected: true },
    { playbackEndedToListeningMs: 900, preconnected: false },
  ]);
});
