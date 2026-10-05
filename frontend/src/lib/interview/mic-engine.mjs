import { getSpeechThreshold } from "./vad-threshold.mjs";
import { stopMediaStreamTracks } from "./session-policy.mjs";
import { isHandoffTimingEnabled } from "./handoff-timing.mjs";
import { errorNameOf, setAudioSessionType } from "./client-environment.mjs";
import { buildAudioConstraints, classifyInputDevice, isDeviceUnavailableError, normalizeDeviceId } from "./mic-device.mjs";

export const calibrationFrameCount = 5;
export const defaultSpeechThreshold = 0.015;
/** Frames held (bounded) between a private engine's calibration and the start of its capture. */
const maximumHeldFrames = 100;
const staleFrameFlushTimeoutMs = 300;
const flushTimeoutMs = 500;
/** How long a resume() may take to reach "running" before the audio graph is rebuilt. */
const resumeTimeoutMs = 600;
/** A capture with no worklet frame for this long is stalled (the audio session was interrupted). */
const frameWatchdogMs = 1_000;
/** A stopped context is resumed this long after its statechange when no answer is being captured. */
const idleResumeDelayMs = 250;
/** A refresh from an answer's first frames is accepted only when it is not contaminated by speech. */
const contaminatedNoiseLevel = 0.025;
/** One mic_level_check diagnostic (peak level only) this long after the first answer window opens. */
const levelCheckDelayMs = 3_000;

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
export function createBrowserMicDeps({ onDiagnostic, onDeviceFallback } = {}) {
  return {
    onDeviceFallback,
    /** iOS: keep output on the speaker while capturing (WebKit Audio Session API; no-op where it does not exist). */
    prepareSession: () => { setAudioSessionType("play-and-record"); },
    restoreSession: () => { setAudioSessionType("auto"); },
    onDiagnostic,
    isSupported: () => typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioWorkletNode !== "undefined",
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createAudioContext: () => new AudioContext(),
    createWorkletNode: (context) => new AudioWorkletNode(context, "pcm-capture-processor", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }),
    workletUrl: "/pcm-capture-processor.js",
    stopTracks: stopMediaStreamTracks,
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    /** Content-free diagnostics, only when the handoff-timing sessionStorage flag is on. */
    onRecovered: (reason) => { if (isHandoffTimingEnabled()) console.info(JSON.stringify({ event: "mic_engine_recovered", reason })); },
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
 * @param {{ deviceId?: string | null }} [options] The chosen input device (null = the browser default).
 * @returns {import("./mic-engine.d.mts").MicEngine}
 */
export function createMicEngine(deps, options = {}) {
  let deviceId = normalizeDeviceId(options.deviceId);
  let peakLevel = 0;
  let levelCheckSent = false;
  let levelCheckTimer = null;
  let inputDeviceKind = "unknown";
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
  let frameCount = 0;
  let watchdogTimer = null;
  let stalledTicks = 0;
  let rebuiltThisAnswer = false;
  let rebuilding = null;
  let idleResumeTimer = null;
  const flushWaiters = new Set();
  const listeners = { state: new Set(), lost: new Set() };

  // Content-free diagnostics (never throws).
  const diagnose = (event) => { try { deps.onDiagnostic?.(event); } catch { /* Diagnostics only. */ } };
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
    clearLevelCheck();
    levelCheckSent = false;
    peakLevel = 0;
    current.track?.removeEventListener?.("ended", current.onEnded);
    current.track?.removeEventListener?.("mute", current.onMute);
    current.context?.removeEventListener?.("statechange", current.onContextState);
    if (current.worklet) current.worklet.port.onmessage = null;
    for (const node of [current.worklet, current.source, current.mute]) { try { node?.disconnect(); } catch { /* Already disconnected. */ } }
    deps.stopTracks(current.stream);
    const context = current.context;
    if (context && context.state !== "closed") void Promise.resolve(context.close()).catch(() => {});
    for (const waiter of flushWaiters) waiter();
    flushWaiters.clear();
  }

  function clearLevelCheck() {
    if (levelCheckTimer !== null) { deps.clearTimeout(levelCheckTimer); levelCheckTimer = null; }
  }

  /** Sends the loudest level of the first seconds of capture once per microphone (a number only, no audio). */
  function armLevelCheck() {
    if (levelCheckSent || levelCheckTimer !== null) return;
    levelCheckTimer = deps.setTimeout(() => {
      levelCheckTimer = null;
      if (levelCheckSent || !graph) return;
      levelCheckSent = true;
      diagnose({ kind: "mic_level_check", peakLevel: Math.min(1, Math.round(peakLevel * 1_000) / 1_000), inputDeviceKind, micActive: true });
    }, levelCheckDelayMs);
  }

  /** Opens the chosen device exactly; a missing/unplugged one falls back to the default input (and is reported). */
  async function openStream() {
    if (deviceId !== null) {
      try {
        return await deps.getUserMedia({ audio: buildAudioConstraints(deviceId) });
      } catch (error) {
        if (!isDeviceUnavailableError(error)) throw error;
        deviceId = null;
        diagnose({ kind: "mic_error", errorName: errorNameOf(error), inputDeviceKind: "unknown" });
        try { deps.onDeviceFallback?.(); } catch { /* Notification only. */ }
      }
    }
    return deps.getUserMedia({ audio: buildAudioConstraints(null) });
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
    if (frame.level > peakLevel) peakLevel = frame.level;
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
    frameCount += 1; // A bare counter (no audio kept): lets the watchdog tell a stalled worklet from a quiet one.
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

  /** Builds context + worklet graph around `stream`. `onContext` reports the context early so failures can close it. */
  async function buildGraph(stream, myEpoch, onContext, reuseTrackListeners = null) {
    const context = deps.createAudioContext();
    onContext(context);
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
    const onEnded = reuseTrackListeners?.onEnded ?? (() => { if (graph?.track === track) trackLost("ended"); });
    const onMute = reuseTrackListeners?.onMute ?? (() => { if (graph?.track === track) trackLost("muted"); });
    if (!reuseTrackListeners) {
      track?.addEventListener?.("ended", onEnded);
      track?.addEventListener?.("mute", onMute);
    }
    const onContextState = () => onContextStateChange(context);
    context.addEventListener?.("statechange", onContextState);
    worklet.port.onmessage = onWorkletMessage;
    return { stream, context, source, worklet, mute, track, onEnded, onMute, onContextState };
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
        try { deps.prepareSession?.(); } catch { /* Best effort. */ }
        stream = await openStream();
        if (myEpoch !== epoch) throw cancelledError();
        graph = await buildGraph(stream, myEpoch, (created) => { context = created; });
        lastError = null;
        setState("ready");
        inputDeviceKind = classifyInputDevice(stream.getAudioTracks?.()[0]?.label);
        diagnose({ kind: "mic_open", micActive: true, micContextState: graph?.context?.state, inputDeviceKind });
      } catch (error) {
        // A rejected/failed acquisition must not leave the page in the "play-and-record" audio session.
        if (!graph) { try { deps.restoreSession?.(); } catch { /* Best effort. */ } }
        if (error?.isCancelled !== true && error?.message !== "unsupported") diagnose({ kind: "mic_error", errorName: errorNameOf(error) });
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

  const isRunning = (context) => context.state === "running";

  /** Resolves true once `context` is running, false after `ms` (or never-running resume). */
  function waitRunning(context, ms) {
    if (isRunning(context)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer = null;
      const finish = (ok) => { context.removeEventListener?.("statechange", onChange); if (timer !== null) deps.clearTimeout(timer); resolve(ok); };
      const onChange = () => { if (isRunning(context)) finish(true); };
      context.addEventListener?.("statechange", onChange);
      timer = deps.setTimeout(() => { timer = null; finish(isRunning(context)); }, ms);
    });
  }

  function resumeContext(context) {
    try { void Promise.resolve(context.resume()).catch(() => {}); } catch { /* Best effort. */ }
  }

  function onContextStateChange(context) {
    if (graph?.context === context) diagnose({ kind: "audio_session", micContextState: context.state });
    if (graph?.context !== context || released || context.state === "running" || context.state === "closed") return;
    if (mode === "capture") { resumeContext(context); return; }
    if (idleResumeTimer !== null) return;
    idleResumeTimer = deps.setTimeout(() => {
      idleResumeTimer = null;
      if (graph?.context === context && !released && context.state !== "running" && context.state !== "closed") resumeContext(context);
    }, idleResumeDelayMs);
  }

  /** Rebuilds the audio graph on the same MediaStream when its track is live, otherwise reacquires the microphone. */
  function rebuildGraph(reason) {
    if (rebuilding) return rebuilding;
    const old = graph;
    if (!old) return Promise.resolve(false);
    deps.onRecovered?.(reason);
    if (old.track?.readyState !== "live" || old.track?.muted === true) return reacquire();
    const myEpoch = epoch;
    const attempt = (async () => {
      let context = null;
      try {
        old.context.removeEventListener?.("statechange", old.onContextState);
        if (old.worklet) old.worklet.port.onmessage = null;
        for (const node of [old.worklet, old.source, old.mute]) { try { node?.disconnect(); } catch { /* Already disconnected. */ } }
        if (old.context.state !== "closed") void Promise.resolve(old.context.close()).catch(() => {});
        for (const waiter of flushWaiters) waiter();
        flushWaiters.clear();
        staleUntilFlushed = false;
        graph = null;
        const next = await buildGraph(old.stream, myEpoch, (created) => { context = created; }, { onEnded: old.onEnded, onMute: old.onMute });
        graph = next;
        await waitRunning(next.context, resumeTimeoutMs);
        return isRunning(next.context);
      } catch {
        if (context && context.state !== "closed") void Promise.resolve(context.close()).catch(() => {});
        if (myEpoch !== epoch) return false;
        return reacquire();
      }
    })();
    rebuilding = attempt;
    const clear = () => { if (rebuilding === attempt) rebuilding = null; };
    attempt.then(clear, clear);
    return attempt;
  }

  /**
   * Resolves true when the context is running. A "suspended"/"interrupted" context (another app or the OS takes the
   * audio session) is resumed; if it does not reach "running" within ~600 ms the graph is rebuilt. No wait when running.
   */
  async function ensureRunning() {
    if (rebuilding) { try { await rebuilding; } catch { /* Handled inside. */ } }
    const current = graph;
    if (!current || released) return false;
    const context = current.context;
    if (isRunning(context)) return true;
    if (context.state === "closed") return rebuildGraph("closed");
    resumeContext(context);
    if (await waitRunning(context, resumeTimeoutMs)) return true;
    if (graph?.context !== context || released) return graph ? isRunning(graph.context) : false;
    return rebuildGraph("resume_timeout");
  }

  function clearWatchdog() {
    if (watchdogTimer !== null) { deps.clearTimeout(watchdogTimer); watchdogTimer = null; }
  }

  function armWatchdog() {
    clearWatchdog();
    const seen = frameCount;
    watchdogTimer = deps.setTimeout(() => {
      watchdogTimer = null;
      if (mode !== "capture") return;
      if (frameCount !== seen) stalledTicks = 0;
      else {
        stalledTicks += 1;
        if (stalledTicks === 1) void ensureRunning();
        else if (!rebuiltThisAnswer) { rebuiltThisAnswer = true; void rebuildGraph("no_frames"); }
      }
      armWatchdog();
    }, frameWatchdogMs);
  }

  function reacquire() {
    epoch += 1;
    acquiring = null;
    rebuilding = null;
    disposeGraph();
    state = "idle";
    return acquire().then(() => true, () => false);
  }

  function isHealthy() {
    return state === "ready" && Boolean(graph) && graph.track?.readyState !== "ended" && graph.track?.muted !== true && graph.context.state !== "closed" && (isRunning(graph.context) || graph.context.state === "suspended" || graph.context.state === "interrupted");
  }

  return {
    get state() { return state; },
    get error() { return lastError; },
    get noiseFloor() { return noiseFloor ?? defaultSpeechThreshold; },
    get calibrated() { return noiseFloor !== null; },
    get capturing() { return mode === "capture"; },
    get deviceId() { return deviceId; },
    /** Chooses the input device for the next acquisition (null = default). Does not restart a running microphone. */
    setDeviceId(next) { deviceId = normalizeDeviceId(next); },
    acquire,
    isHealthy,
    ensureRunning,
    /** Resolves true when frames can flow: reuses a healthy mic, reacquires (once) an ended/muted/forced one. */
    async ensureHealthy({ force = false } = {}) {
      if (state === "acquiring" && acquiring) { try { await acquiring; } catch { return false; } }
      if (released) return false;
      if (state === "ready" && !force && isHealthy()) {
        return (await ensureRunning()) || (state === "ready" && Boolean(graph));
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
      clearWatchdog();
      clearLevelCheck();
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
      stalledTicks = 0;
      rebuiltThisAnswer = false;
      armWatchdog();
      refreshLevels = [];
      armLevelCheck();
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
      clearWatchdog();
      clearLevelCheck();
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
      clearWatchdog();
      clearLevelCheck();
      if (idleResumeTimer !== null) { deps.clearTimeout(idleResumeTimer); idleResumeTimer = null; }
      rebuilding = null;
      sink = null;
      refreshLevels = null;
      held = [];
      interviewerSpeaking = false;
      const hadGraph = Boolean(graph);
      disposeGraph();
      if (hadGraph) {
        try { deps.restoreSession?.(); } catch { /* Best effort. */ }
        diagnose({ kind: "mic_close", micActive: false });
      }
      state = "idle";
      emit("state", "idle");
    },
  };
}
