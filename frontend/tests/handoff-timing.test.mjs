import assert from "node:assert/strict";
import test from "node:test";
import { createInterviewHandoffTiming, handoffTimingStorageKey, isHandoffTimingEnabled } from "../src/lib/interview/handoff-timing.mjs";

test("handoff timing decomposes VAD, queue, Whisper, decision, synthesis, and playback", () => {
  const timestamps = {
    finalizingReceived: 100,
    transcriptionQueued: 150,
    transcriptionStarted: 350,
    transcriptionCompleted: 3_350,
    decisionStarted: 3_400,
    decisionCompleted: 3_600,
    synthesisStarted: 3_950,
    synthesisCompleted: 4_450,
    playbackStarted: 4_650,
  };
  let metrics;
  const timing = createInterviewHandoffTiming({
    speechEndToFinalizationMs: 3_400,
    now: () => timestamps.finalizingReceived,
    onComplete: (value) => { metrics = value; },
  });

  for (const [stage, time] of Object.entries(timestamps)) {
    timestamps.finalizingReceived = time;
    timing.mark(stage);
  }

  assert.deepEqual(metrics, {
    totalMs: 7_950,
    vadFinalizationMs: 3_450,
    queueWaitMs: 200,
    whisperMs: 3_000,
    decisionMs: 200,
    synthesisMs: 500,
    playbackStartMs: 200,
    unaccountedMs: 400,
  });
  assert.deepEqual(Object.keys(metrics), ["totalMs", "vadFinalizationMs", "queueWaitMs", "whisperMs", "decisionMs", "synthesisMs", "playbackStartMs", "unaccountedMs"]);
});

test("handoff timing is emitted once and leaves unknown queue wait at zero", () => {
  const values = [10, 20, 120, 420, 440, 540, 640, 740];
  let index = 0;
  const emitted = [];
  const timing = createInterviewHandoffTiming({ now: () => values[index++], onComplete: (metrics) => emitted.push(metrics) });
  for (const stage of ["finalizingReceived", "transcriptionStarted", "transcriptionCompleted", "decisionStarted", "decisionCompleted", "synthesisStarted", "synthesisCompleted", "playbackStarted", "playbackStarted"]) {
    timing.mark(stage);
  }
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].queueWaitMs, 0);
  assert.equal(emitted[0].whisperMs, 100);
});

test("diagnostics are opt-in through session storage and default off", () => {
  const originalWindow = globalThis.window;
  try {
    delete globalThis.window;
    assert.equal(isHandoffTimingEnabled(), false);
    globalThis.window = { sessionStorage: { getItem: (key) => key === handoffTimingStorageKey ? "1" : null } };
    assert.equal(isHandoffTimingEnabled(), true);
    globalThis.window.sessionStorage.getItem = () => "true";
    assert.equal(isHandoffTimingEnabled(), false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
