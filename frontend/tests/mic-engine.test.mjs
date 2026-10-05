import assert from "node:assert/strict";
import test from "node:test";
import { calibrationFrameCount, createMicEngine, defaultSpeechThreshold } from "../src/lib/interview/mic-engine.mjs";
import { getSpeechThreshold } from "../src/lib/interview/vad-threshold.mjs";
import { createFakeMicDeps, runTimers, tick } from "./mic-fakes.mjs";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} !~ ${expected}`);

async function readyEngine(options) {
  const deps = createFakeMicDeps(options);
  const engine = createMicEngine(deps);
  await engine.acquire();
  deps.log.contexts[0].resumeCalls = 0; // acquisition's own resume() does not count
  return { deps, engine, worklet: deps.log.worklets[0], track: deps.log.tracks[0] };
}

test("the microphone is acquired once, reused for every answer and released with the room", async () => {
  const { deps, engine, worklet, track } = await readyEngine();
  await engine.acquire();
  assert.equal(await engine.ensureHealthy(), true);
  assert.equal(deps.log.getUserMedia, 1);
  assert.equal(deps.log.contexts.length, 1);

  for (let answer = 0; answer < 3; answer += 1) {
    const frames = [];
    engine.startCapture((frame) => frames.push(frame));
    worklet.frame(0.1);
    engine.stopCapture();
    assert.equal(frames.length, 1, `answer ${answer}`);
    assert.equal(await engine.ensureHealthy(), true);
  }
  assert.equal(deps.log.getUserMedia, 1);
  assert.equal(deps.log.contexts.length, 1);
  assert.equal(track.stopped, false);

  engine.release();
  assert.equal(track.stopped, true);
  assert.equal(deps.log.contexts[0].state, "closed");
  assert.equal(worklet.port.onmessage, null);
  assert.equal(engine.state, "idle");
});

test("frames outside an answer window are discarded and never reach a consumer", async () => {
  const { engine, worklet } = await readyEngine();
  const received = [];
  worklet.frame(0.2); // idle: nobody is listening
  engine.startCapture((frame) => received.push(frame.level.toFixed(2)));
  worklet.frame(0.1);
  engine.beginInterviewerSpeech(); // playback started: capture is force-stopped
  worklet.frame(0.3);
  worklet.frame(0.4);
  assert.deepEqual(received, ["0.10"]);
  assert.equal(engine.capturing, false);
});

test("frames already in flight when the answer window opens are dropped until the worklet flushes", async () => {
  const { engine, worklet } = await readyEngine({ autoFlush: false });
  const received = [];
  engine.startCapture((frame) => received.push(frame.level.toFixed(2)));
  worklet.frame(0.5); // the interviewer's tail, posted before the window opened
  assert.deepEqual(received, []);
  worklet.deliverFlush();
  worklet.frame(0.1);
  assert.deepEqual(received, ["0.10"]);
});

test("the noise floor is calibrated once from silent frames and never while the interviewer speaks", async () => {
  const { engine, worklet } = await readyEngine();
  assert.equal(engine.calibrated, false);
  assert.equal(engine.noiseFloor, defaultSpeechThreshold);
  const calibration = engine.calibrate();
  for (let index = 0; index < calibrationFrameCount; index += 1) worklet.frame(0.01);
  near(await calibration, getSpeechThreshold(Array(calibrationFrameCount).fill(0.01)));
  assert.equal(engine.calibrated, true);
  worklet.frame(0.01);

  const aborted = readyEngine();
  const second = await aborted;
  const pending = second.engine.calibrate();
  second.worklet.frame(0.01);
  second.engine.beginInterviewerSpeech(); // TTS starts mid-calibration
  assert.equal(await pending, null);
  assert.equal(second.engine.calibrated, false);
  assert.equal(await second.engine.calibrate(), null, "no calibration while the interviewer speaks");
});

test("calibration frames are never forwarded to a consumer", async () => {
  const { engine, worklet } = await readyEngine();
  const calibration = engine.calibrate();
  for (let index = 0; index < calibrationFrameCount; index += 1) worklet.frame(0.01);
  await calibration;
  const received = [];
  engine.startCapture((frame) => received.push(frame), { replayHeld: false });
  assert.deepEqual(received, []);
});

test("the answer's first frames refresh the noise floor unless speech contaminated them", async () => {
  const { engine, worklet } = await readyEngine();
  engine.startCapture(() => {});
  for (let index = 0; index < calibrationFrameCount; index += 1) worklet.frame(0.02);
  near(engine.noiseFloor, 0.025);
  const refreshed = engine.noiseFloor;
  engine.stopCapture();

  engine.startCapture(() => {});
  for (let index = 0; index < calibrationFrameCount; index += 1) worklet.frame(0.2); // speaking from the first frame
  assert.equal(engine.noiseFloor, refreshed);
  assert.notEqual(refreshed, defaultSpeechThreshold);
});

test("a private engine keeps its calibration frames for the answer and replays them in order", async () => {
  const { engine, worklet } = await readyEngine();
  const calibration = engine.calibrate({ keepFrames: true });
  for (let index = 1; index <= calibrationFrameCount; index += 1) worklet.frame(index / 100);
  await calibration;
  worklet.frame(0.06);
  const received = [];
  engine.startCapture((frame) => received.push(frame.level.toFixed(2)), { replayHeld: true });
  worklet.frame(0.07);
  assert.deepEqual(received, ["0.01", "0.02", "0.03", "0.04", "0.05", "0.06", "0.07"]);
});

test("flush delivers the partial frame to the sink before resolving", async () => {
  const { engine, worklet } = await readyEngine();
  const received = [];
  engine.startCapture((frame) => received.push(frame.samples.length));
  worklet.partialLevel = 0.1;
  await engine.flush();
  assert.deepEqual(received, [800]);
});

test("an ended track is reacquired once automatically while idle", async () => {
  const { deps, engine, track } = await readyEngine();
  const lost = [];
  engine.on("lost", (reason) => lost.push(reason));
  track.emit("ended");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(lost, ["ended"]);
  assert.equal(deps.log.getUserMedia, 2);
  assert.equal(engine.state, "ready");

  deps.log.tracks[1].emit("ended"); // a second loss in the same answer cycle is not retried automatically
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(deps.log.getUserMedia, 2);
  assert.equal(engine.isHealthy(), false);
  assert.equal(await engine.ensureHealthy(), true, "the next answer window reacquires");
  assert.equal(deps.log.getUserMedia, 3);
});

test("ensureHealthy reuses a healthy microphone, reacquires a muted or forced one", async () => {
  const { deps, engine, track } = await readyEngine();
  assert.equal(await engine.ensureHealthy(), true);
  assert.equal(deps.log.getUserMedia, 1);

  track.emit("mute");
  assert.equal(engine.isHealthy(), false);
  assert.equal(await engine.ensureHealthy(), true);
  assert.equal(deps.log.getUserMedia, 2);
  assert.equal(track.stopped, true, "the muted track is released");

  assert.equal(await engine.ensureHealthy({ force: true }), true);
  assert.equal(deps.log.getUserMedia, 3);
});

test("a denied microphone leaves the engine failed so the caller can fall back", async () => {
  const deps = createFakeMicDeps({ rejectWith: Object.assign(new Error("denied"), { name: "NotAllowedError" }) });
  const engine = createMicEngine(deps);
  await assert.rejects(engine.acquire(), /denied/);
  assert.equal(engine.state, "failed");
  assert.equal(await engine.ensureHealthy(), false);
  assert.equal(deps.log.contexts.length, 0);
});

test("releasing during acquisition stops the late stream and a released engine does not revive", async () => {
  const deps = createFakeMicDeps();
  const engine = createMicEngine(deps);
  const pending = engine.acquire();
  engine.release();
  await assert.rejects(pending, /cancelled/);
  assert.equal(deps.log.tracks[0].stopped, true);
  assert.equal(engine.state, "idle");
  assert.equal(await engine.ensureHealthy(), false);
  await engine.acquire(); // StrictMode style re-acquire is allowed
  assert.equal(engine.state, "ready");
});

// --- An interrupted audio session (another app, the OS) suspends the context ---

test("an interrupted context is resumed before the answer and frames flow", async () => {
  const { deps, engine, worklet } = await readyEngine();
  const context = deps.log.contexts[0];
  context.setState("interrupted");
  assert.equal(engine.isHealthy(), true);
  assert.equal(await engine.ensureHealthy(), true);
  assert.equal(context.state, "running");
  assert.equal(context.resumeCalls, 1);
  assert.equal(deps.log.getUserMedia, 1);
  const frames = [];
  engine.startCapture((frame) => frames.push(frame));
  worklet.frame(0.1);
  assert.equal(frames.length, 1);
});

test("a running context takes the no-op fast path: no resume call, no timer, no rebuild", async () => {
  const { deps, engine } = await readyEngine();
  const timersBefore = deps.log.timers.length;
  assert.equal(await engine.ensureRunning(), true);
  assert.equal(await engine.ensureHealthy(), true);
  assert.equal(deps.log.contexts[0].resumeCalls, 0);
  assert.equal(deps.log.timers.length, timersBefore);
  assert.equal(deps.log.contexts.length, 1);
});

test("a context that never reaches running is rebuilt on the same MediaStream", async () => {
  const { deps, engine, track } = await readyEngine();
  const stuck = deps.log.contexts[0];
  stuck.resumeBehavior = "never";
  stuck.setState("interrupted");
  const pending = engine.ensureRunning();
  await tick();
  runTimers(deps); // the 600 ms resume wait elapses
  assert.equal(await pending, true);
  assert.equal(deps.log.getUserMedia, 1, "same stream, no new getUserMedia");
  assert.equal(deps.log.contexts.length, 2);
  assert.equal(stuck.state, "closed");
  assert.equal(track.stopped, false);
  assert.deepEqual(deps.log.recovered, ["resume_timeout"]);
  const frames = [];
  engine.startCapture((frame) => frames.push(frame));
  deps.log.worklets[1].frame(0.1);
  deps.log.worklets[0].frame(0.1); // the old worklet is detached
  assert.equal(frames.length, 1);
});

test("a dead track makes the rebuild a full reacquire", async () => {
  const { deps, engine, track } = await readyEngine();
  const stuck = deps.log.contexts[0];
  stuck.resumeBehavior = "never";
  stuck.setState("interrupted");
  track.readyState = "ended";
  const pending = engine.ensureRunning();
  await tick();
  runTimers(deps);
  assert.equal(await pending, true);
  assert.equal(deps.log.getUserMedia, 2);
});

test("statechange resumes: immediately while capturing, after a short delay while idle", async () => {
  const { deps, engine } = await readyEngine();
  const context = deps.log.contexts[0];
  context.setState("interrupted");
  assert.equal(context.resumeCalls, 0);
  assert.equal(runTimers(deps), 1);
  await tick();
  assert.equal(context.state, "running");
  assert.equal(context.resumeCalls, 1);

  engine.startCapture(() => {});
  context.setState("suspended");
  await tick();
  assert.equal(context.resumeCalls, 2);
  assert.equal(context.state, "running");
});

test("the frame watchdog calls ensureRunning, then rebuilds the graph once per answer", async () => {
  const { deps, engine } = await readyEngine();
  const context = deps.log.contexts[0];
  context.resumeBehavior = "never";
  const frames = [];
  engine.startCapture((frame) => frames.push(frame));
  context.state = "suspended"; // silently stuck: no statechange, no frames
  assert.equal(runTimers(deps), 1 + 1 + 1); // stale-flush timer + watchdog tick 1 + level check
  await tick();
  assert.ok(context.resumeCalls >= 1, "first stall: ensureRunning resumes");
  assert.equal(deps.log.contexts.length, 1);
  runTimers(deps); // resume wait elapses -> rebuild, and/or watchdog tick 2
  await tick(); await tick();
  assert.equal(deps.log.contexts.length, 2, "rebuilt");
  assert.equal(deps.log.getUserMedia, 1);
  deps.log.worklets[1].frame(0.1);
  assert.equal(frames.length, 1);
  for (let index = 0; index < 4; index += 1) { runTimers(deps); await tick(); }
  assert.equal(deps.log.contexts.length, 2, "no second rebuild for the same answer");
  engine.stopCapture();
  assert.equal(deps.log.timers.length, 0, "watchdog cancelled with the answer");
});

test("the watchdog stays quiet while frames arrive and is cancelled when the answer ends", async () => {
  const { deps, engine, worklet } = await readyEngine();
  engine.startCapture(() => {});
  worklet.frame(0.1);
  runTimers(deps);
  await tick();
  assert.equal(deps.log.contexts[0].resumeCalls, 0);
  engine.stopCapture();
  assert.equal(deps.log.timers.length, 0, "no timers left after the answer");
});

test("privacy: a rebuilt or resumed graph still drops every frame outside an answer window", async () => {
  const { deps, engine } = await readyEngine();
  const stuck = deps.log.contexts[0];
  stuck.resumeBehavior = "never";
  stuck.setState("interrupted");
  const pending = engine.ensureRunning();
  await tick();
  runTimers(deps);
  await pending;
  const received = [];
  deps.log.worklets[1].frame(0.4); // idle
  engine.startCapture((frame) => received.push(frame.level.toFixed(1)));
  deps.log.worklets[1].frame(0.1);
  engine.stopCapture();
  deps.log.worklets[1].frame(0.5);
  engine.beginInterviewerSpeech();
  deps.log.worklets[1].frame(0.6);
  assert.deepEqual(received, ["0.1"]);
});

test("force still performs a full reacquire (silent-mic retry)", async () => {
  const { deps, engine } = await readyEngine();
  assert.equal(await engine.ensureHealthy({ force: true }), true);
  assert.equal(deps.log.getUserMedia, 2);
});

test("the audio session is declared before getUserMedia, restored on release, and mic open/close are reported", async () => {
  const deps = createFakeMicDeps();
  const order = [];
  const events = [];
  const originalGetUserMedia = deps.getUserMedia;
  deps.getUserMedia = (constraints) => { order.push("getUserMedia"); return originalGetUserMedia(constraints); };
  deps.prepareSession = () => order.push("prepare");
  deps.restoreSession = () => order.push("restore");
  deps.onDiagnostic = (event) => events.push(event);
  const engine = createMicEngine(deps);
  await engine.acquire();
  engine.release();
  assert.deepEqual(order, ["prepare", "getUserMedia", "restore"]);
  assert.deepEqual(events.map((event) => event.kind), ["mic_open", "mic_close"]);
  assert.equal(events[0].micActive, true);
  assert.equal(events[1].micActive, false);
});

test("a throwing diagnostics callback or session setup never breaks the microphone", async () => {
  const deps = createFakeMicDeps();
  deps.prepareSession = () => { throw new Error("no api"); };
  deps.onDiagnostic = () => { throw new Error("nope"); };
  const engine = createMicEngine(deps);
  await engine.acquire();
  assert.equal(engine.state, "ready");
  engine.release();
});

test("a rejected getUserMedia restores the audio session and reports a content-free mic_error", async () => {
  const deps = createFakeMicDeps({ rejectWith: Object.assign(new Error("secret message"), { name: "NotAllowedError" }) });
  const calls = [];
  const events = [];
  deps.prepareSession = () => calls.push("prepare");
  deps.restoreSession = () => calls.push("restore");
  deps.onDiagnostic = (event) => events.push(event);
  const engine = createMicEngine(deps);
  await assert.rejects(engine.acquire(), /secret message/);
  assert.deepEqual(calls, ["prepare", "restore"]);
  assert.deepEqual(events, [{ kind: "mic_error", errorName: "NotAllowedError" }]);
});
