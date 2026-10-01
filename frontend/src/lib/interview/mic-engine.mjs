import { getSpeechThreshold } from "./vad-threshold.mjs";
import { stopMediaStreamTracks } from "./session-policy.mjs";

export const calibrationFrameCount = 5;
export const defaultSpeechThreshold = 0.015;
/** Frames held (bounded) between a private engine's calibration and the start of its capture. */
const maximumHeldFrames = 100;
const staleFrameFlushTimeoutMs = 300;
const flushTimeoutMs = 500;
/** A refresh from an answer's first frames is accepted only when it is not contaminated by speech. */
const contaminatedNoiseLevel = 0.025;

export function rootMeanSquare(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function cancelledError() {
  return Object.assign(new Error("cancelled"), { isCancelled: true });
}

/**
 * Browser dependencies of the engine. Everything touching globals is lazy so the module imports in Node.
 * @returns {import("./mic-engine.d.mts").MicEngineDeps}
 */
export function createBrowserMicDeps() {
  return {
    isSupported: () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioWorkletNode !== "undefined",
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createAudioContext: () => new AudioContext(),
    createWorkletNode: (context) => new AudioWorkletNode(context, "pcm-capture-processor", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }),
    workletUrl: "/pcm-capture-processor.js",
    stopTracks: stopMediaStreamTracks,
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

/**
 * A microphone held for a whole interview: one getUserMedia, one AudioContext and one worklet graph.
 *
 * Privacy contract: PCM frames reach a consumer only while a capture is active (`startCapture` until `stopCapture`,
 * i.e. an answer window). In every other mode (the default) frames are dropped at the first line of the worklet
 * message handler: never buffered, never forwarded, never persisted. `beginInterviewerSpeech` force-stops any capture.
 * Modes: discard (default) | calibrate (noise floor, interviewer silent) | hold (private engine only, bounded) | capture.
 * @param {import("./mic-engine.d.mts").MicEngineDeps} deps
 * @returns {import("./mic-engine.d.mts").MicEngine}
 */
export function createMicEngine(deps) {
  let state = "idle";
  let epoch = 0;
  let released = false;
  let acquiring = null;
  let graph = null;
  let mode = "discard";
  let sink = null;
  let interviewerSpeaking = false;
  let calibration = null;
  let held = [];
  let noiseFloor = null;
  let staleUntilFlushed = false;
  let staleTimer = null;
  let refreshLevels = null;
  let autoRecoveries = 0;
  let lastError = null;
  const flushWaiters = new Set();
  const listeners = { state: new Set(), lost: new Set() };

  const emit = (event, value) => { for (const listener of [...listeners[event]]) listener(value); };
  const setState = (next) => {
    if (state === next) return;
    state = next;
    emit("state", next);
  };

  function disposeGraph() {
    const current = graph;
    graph = null;
    if (!current) return;
    current.track?.removeEventListener?.("ended", current.onEnded);
    current.track?.removeEventListener?.("mute", current.onMute);
    if (current.worklet) current.worklet.port.onmessage = null;
    for (const node of [current.worklet, current.source, current.mute]) { try { node?.disconnect(); } catch { /* Already disconnected. */ } }
    deps.stopTracks(current.stream);
    const context = current.context;
    if (context && context.state !== "closed") void Promise.resolve(context.close()).catch(() => {});
    for (const waiter of flushWaiters) waiter();
    flushWaiters.clear();
  }

  function finishCalibration(ok) {
    const current = calibration;
    if (!current) return;
    calibration = null;
    deps.clearTimeout(current.timer);
    if (!ok || current.frames.length < current.target) {
      mode = "discard";
      held = [];
      current.resolve(null);
      return;
    }
    noiseFloor = getSpeechThreshold(current.frames.map((frame) => frame.level));
    if (current.keep) { held = current.frames; mode = "hold"; } else mode = "discard";
    current.resolve(noiseFloor);
  }

  function deliver(frame) {
    if (refreshLevels) {
      refreshLevels.push(frame.level);
      if (refreshLevels.length === calibrationFrameCount) {
        const ordered = [...refreshLevels].sort((left, right) => left - right);
        refreshLevels = null;
        // Reuse and refresh: keep the new floor for the NEXT answer unless speech contaminated these frames.
        if ((ordered[1] ?? ordered[0]) < contaminatedNoiseLevel) noiseFloor = getSpeechThreshold(ordered);
      }
    }
    sink?.(frame);
  }

  function onWorkletMessage(event) {
    const data = event.data;
    if (data?.type === "flushed") {
      staleUntilFlushed = false;
      for (const waiter of [...flushWaiters]) waiter();
      flushWaiters.clear();
      return;
    }
    // Privacy: outside an answer window frames are dropped here, before any allocation or reference is kept.
    if (mode === "discard" || staleUntilFlushed || !data?.samples) return;
    const samples = new Float32Array(data.samples);
    const frame = { samples, level: rootMeanSquare(samples) };
    if (mode === "calibrate") {
      calibration.frames.push(frame);
      if (calibration.frames.length >= calibration.target) finishCalibration(true);
    } else if (mode === "hold") {
      held.push(frame);
      if (held.length > maximumHeldFrames) held.shift();
    } else if (mode === "capture") deliver(frame);
  }

  function trackLost(reason) {
    emit("lost", reason);
    if (reason === "ended" && mode !== "capture" && autoRecoveries < 1 && !released) {
      autoRecoveries += 1;
      void reacquire();
    }
  }

  function acquire() {
    released = false;
    if (state === "ready") return Promise.resolve();
    if (acquiring) return acquiring;
    const myEpoch = epoch;
    setState("acquiring");
    const attempt = (async () => {
      let stream = null;
      let context = null;
      try {
        if (!deps.isSupported()) throw new Error("unsupported");
        stream = await deps.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        if (myEpoch !== epoch) throw cancelledError();
        context = deps.createAudioContext();
        await context.audioWorklet.addModule(deps.workletUrl);
        await context.resume();
        if (myEpoch !== epoch) throw cancelledError();
        const source = context.createMediaStreamSource(stream);
        const worklet = deps.createWorkletNode(context);
        const mute = context.createGain();
        mute.gain.value = 0;
        source.connect(worklet);
        worklet.connect(mute);
        mute.connect(context.destination);
        const track = stream.getAudioTracks?.()[0] ?? null;
        const onEnded = () => { if (graph?.track === track) trackLost("ended"); };
        const onMute = () => { if (graph?.track === track) trackLost("muted"); };
        track?.addEventListener?.("ended", onEnded);
        track?.addEventListener?.("mute", onMute);
        worklet.port.onmessage = onWorkletMessage;
        graph = { stream, context, source, worklet, mute, track, onEnded, onMute };
        lastError = null;
        setState("ready");
      } catch (error) {
        if (!graph || graph.stream !== stream) {
          if (stream) deps.stopTracks(stream);
          if (context && context.state !== "closed") void Promise.resolve(context.close()).catch(() => {});
        }
        if (myEpoch === epoch) { lastError = error; setState("failed"); }
        throw error;
      }
    })();
    acquiring = attempt;
    const clear = () => { if (acquiring === attempt) acquiring = null; };
    attempt.then(clear, clear);
    return attempt;
  }

  function reacquire() {
    epoch += 1;
    acquiring = null;
    disposeGraph();
    state = "idle";
    return acquire().then(() => true, () => false);
  }

  function isHealthy() {
    return state === "ready" && Boolean(graph) && graph.track?.readyState !== "ended" && graph.track?.muted !== true && graph.context.state !== "closed";
  }

  return {
    get state() { return state; },
    get error() { return lastError; },
    get noiseFloor() { return noiseFloor ?? defaultSpeechThreshold; },
    get calibrated() { return noiseFloor !== null; },
    get capturing() { return mode === "capture"; },
    acquire,
    isHealthy,
    /** Resolves true when frames can flow: reuses a healthy mic, reacquires (once) an ended/muted/forced one. */
    async ensureHealthy({ force = false } = {}) {
      if (state === "acquiring" && acquiring) { try { await acquiring; } catch { return false; } }
      if (released) return false;
      if (state === "ready" && !force && isHealthy()) {
        if (graph.context.state === "suspended") { try { await graph.context.resume(); } catch { /* Best effort. */ } }
        return true;
      }
      if (state === "idle" || state === "failed") return acquire().then(() => true, () => false);
      return reacquire();
    },
    /** Measures the noise floor from `frames` frames captured while the interviewer is silent; null if it cannot. */
    calibrate({ keepFrames = false, frames = calibrationFrameCount, timeoutMs = 1_500 } = {}) {
      if (state !== "ready" || interviewerSpeaking || calibration || mode === "capture") return Promise.resolve(null);
      return new Promise((resolve) => {
        calibration = { frames: [], target: frames, keep: keepFrames, resolve, timer: deps.setTimeout(() => finishCalibration(false), timeoutMs) };
        held = [];
        mode = "calibrate";
      });
    },
    /** The interviewer is (about to be) speaking: stop any capture and calibration; frames are discarded. */
    beginInterviewerSpeech() {
      interviewerSpeaking = true;
      finishCalibration(false);
      mode = "discard";
      sink = null;
      refreshLevels = null;
      held = [];
    },
    /**
     * Opens an answer window: from now on every frame goes to `sink`. Frames that were already in flight from
     * before this instant (possibly the interviewer's tail) are dropped unless `replayHeld` (private engine).
     */
    startCapture(frameSink, { replayHeld = false } = {}) {
      if (state !== "ready") throw new Error("mic_unavailable");
      interviewerSpeaking = false;
      autoRecoveries = 0;
      if (calibration) finishCalibration(false);
      sink = frameSink;
      refreshLevels = [];
      const replay = replayHeld && mode === "hold" ? held : [];
      held = [];
      mode = "capture";
      if (!replayHeld) {
        staleUntilFlushed = true;
        if (staleTimer !== null) deps.clearTimeout(staleTimer);
        staleTimer = deps.setTimeout(() => { staleUntilFlushed = false; staleTimer = null; }, staleFrameFlushTimeoutMs);
        graph.worklet.port.postMessage({ type: "flush" });
      }
      for (const frame of replay) deliver(frame);
    },
    /** Closes the answer window; frames are discarded again. */
    stopCapture() {
      if (mode === "capture" || mode === "hold") mode = "discard";
      sink = null;
      refreshLevels = null;
      held = [];
    },
    /** Delivers the worklet's partial frame to the sink, then resolves (bounded wait). */
    flush() {
      if (!graph || mode !== "capture") return Promise.resolve();
      const worklet = graph.worklet;
      return new Promise((resolve) => {
        let done = false;
        const timer = deps.setTimeout(() => finish(), flushTimeoutMs);
        const finish = () => { if (done) return; done = true; deps.clearTimeout(timer); flushWaiters.delete(finish); resolve(); };
        flushWaiters.add(finish);
        worklet.port.postMessage({ type: "flush" });
      });
    },
    on(event, listener) {
      listeners[event].add(listener);
      return () => listeners[event].delete(listener);
    },
    /** Releases the microphone, context and worklet. The engine can be acquired again afterwards. */
    release() {
      epoch += 1;
      released = true;
      acquiring = null;
      finishCalibration(false);
      mode = "discard";
      sink = null;
      refreshLevels = null;
      held = [];
      interviewerSpeaking = false;
      disposeGraph();
      state = "idle";
      emit("state", "idle");
    },
  };
}
