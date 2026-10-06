import assert from "node:assert/strict";
import test from "node:test";

import { createAnswerStream } from "../src/lib/interview/answer-stream.mjs";
import { createNextTurnPreparationRegistry } from "../src/lib/interview/next-turn-preparation.mjs";
import { clearRetainedSpeechBlobs, playInterviewerSegments, prewarmInterviewerSpeech, resetSpeechFlights } from "../src/lib/interview/speech-playback.mjs";

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));

class FakeAudio {
  constructor(played) { this.listeners = new Map(); this.played = played; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener() { }
  pause() { }
  removeAttribute() { }
  load() { }
  play() { this.played.push("play"); this.listeners.get("playing")?.(); this.listeners.get("ended")?.(); return Promise.resolve(); }
}

class FakeSocket {
  readyState = 1;
  bufferedAmount = 0;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  send(data) {
    if (typeof data === "string" && JSON.parse(data).type !== "cancel") this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
  }
  close() { this.readyState = 3; }
}

test("90-second answer overlaps report/speculation/prewarms, then opens the next transcription without stale revision/audio", async () => {
  resetSpeechFlights();
  clearRetainedSpeechBlobs();
  const speechRequests = [];
  const speechFetcher = async (_url, init) => {
    const text = JSON.parse(init.body).text;
    speechRequests.push(text);
    return { ok: true, blob: async () => new Blob([text]) };
  };
  const speechOptions = { endpoint: "/speech", fetcher: speechFetcher, retainMs: 240_000, setTimeout: () => 1, clearTimeout() { } };

  // Model an answer clock without making the regression test sleep for a real 90 seconds.
  let answerElapsedMs = 0;
  const fixedPrewarms = ["Transition.", "Fixed question one?", "Fixed question two?"].map((text) => prewarmInterviewerSpeech([text], speechOptions));
  const backgroundReport = deferred();
  let reportStillPendingAfterAnswer = false;
  const reportRequest = backgroundReport.promise;

  const registry = createNextTurnPreparationRegistry();
  const oldModel = deferred();
  let staleCleanupCount = 0;
  registry.prepare({ transcript: "provisional revision one", run: (_signal, onCleanup) => {
    onCleanup(() => { staleCleanupCount += 1; });
    return oldModel.promise;
  } });
  const newest = deferred();
  registry.prepare({ transcript: "provisional revision two", run: async (signal, onCleanup) => {
    const prewarm = prewarmInterviewerSpeech(["Next question revision two?"], speechOptions);
    onCleanup(prewarm.cancel);
    await newest.promise;
    if (signal.aborted) return null;
    return { revision: 2, question: "Next question revision two?" };
  } });
  assert.equal(staleCleanupCount, 1, "replacing a speculative revision cleans up its work");
  newest.resolve();
  await tick();
  answerElapsedMs = 90_000;
  await Promise.all(fixedPrewarms.map((prewarm) => prewarm.promise));
  const claimed = registry.take({ transcript: "provisional revision two" });
  assert.ok(claimed);
  const decision = await claimed.promise;
  assert.equal(decision.revision, 2);
  reportStillPendingAfterAnswer = true;
  assert.equal(answerElapsedMs, 90_000);

  // A late response from the superseded revision is ignored by the aborted preparation.
  oldModel.resolve({ revision: 1, question: "Stale question revision one?" });
  await tick();
  assert.equal(registry.take({ transcript: "provisional revision one" }), null);

  const played = [];
  const playback = playInterviewerSegments([decision.question], {
    ...speechOptions,
    makeAudio: () => new FakeAudio(played),
    createObjectUrl: () => "blob:next",
    revokeObjectUrl() { },
  });
  assert.deepEqual(await playback.promise, { status: "completed", voice: "network" });
  assert.deepEqual(played, ["play"]);
  assert.ok(!speechRequests.includes("Next question revision one?"), "stale audio was never synthesized or played");
  assert.ok(speechRequests.includes("Next question revision two?"), "the current revision was prewarmed and reused");
  assert.equal(speechRequests.length, 4, "three fixed prewarms and one current speculative prewarm were synthesized");

  let streamedFrames = 0;
  const stream = createAnswerStream({
    openSocket: () => {
      const socket = new FakeSocket();
      queueMicrotask(() => socket.onopen?.());
      return socket;
    },
    buildStartMessage: async () => ({ type: "start" }),
    encodeFrame: () => new ArrayBuffer(4),
  });
  await stream.begin();
  stream.pushFrame({ samples: new Float32Array([0.1]), level: 0.1 });
  streamedFrames += 1;
  assert.equal(stream.state, "streaming");
  assert.equal(stream.gateOpen, true);
  assert.equal(streamedFrames, 1, "next-question transcription accepts frames only after begin");
  assert.equal(reportStillPendingAfterAnswer, true, "report work remains background work while the next question starts");

  // Capacity inputs for a virtual single session: peak candidates are three fixed speech chunks plus one report
  // request and one speculative model request; the later transcription socket is one additional live connection.
  const capacity = { simultaneousSessions: 1, logicalAnswerMs: answerElapsedMs, fixedSpeechPrewarms: 3, speculativeRevisions: 2, reportRequests: 1, nextTranscriptionSockets: 1 };
  assert.deepEqual(capacity, { simultaneousSessions: 1, logicalAnswerMs: 90_000, fixedSpeechPrewarms: 3, speculativeRevisions: 2, reportRequests: 1, nextTranscriptionSockets: 1 });
  backgroundReport.resolve();
  await reportRequest;
  stream.cancel();
  clearRetainedSpeechBlobs();
  resetSpeechFlights();
});
