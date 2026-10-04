// iOS/WebKit routes HTMLMediaElement output to the receiver (or mutes it) once a microphone capture switches the audio
// session to play-and-record. Web Audio output keeps using the session's speaker route, which is the pattern WebRTC
// apps rely on. On iOS the interviewer therefore plays through a shared AudioContext (resumed inside a user gesture)
// and an AudioBufferSourceNode. `createWebAudioTrack` exposes the small HTMLAudioElement surface that
// speech-playback.mjs uses (play/pause/events/currentTime/duration/preload/removeAttribute/load), so the playback
// logic is shared; desktop keeps HTMLAudioElement.

import { isIosWebKit } from "./client-environment.mjs";

export const TRACK_TIME_UPDATE_MS = 250;
// How long a suspended/interrupted context may take to reach "running" before play() is refused.
export const CONTEXT_RESUME_TIMEOUT_MS = 800;

export const shouldUseWebAudio = (nav = typeof navigator === "undefined" ? undefined : navigator, hasAudioContext = typeof AudioContext !== "undefined") =>
  hasAudioContext && isIosWebKit(nav);

let sharedContext = null;

/** Test hook. */
export function resetPlaybackContext() { sharedContext = null; }

export function getPlaybackContext(create = () => new AudioContext()) {
  if (!sharedContext || sharedContext.state === "closed") sharedContext = create();
  return sharedContext;
}

export const peekPlaybackContext = () => sharedContext;

/**
 * Must run synchronously inside a user gesture: creates (once) and resumes the shared playback context and plays one
 * silent sample, which is what makes iOS accept later programmatic starts. Returns the context state afterwards.
 */
export function unlockPlaybackContext({ create } = {}) {
  try {
    const context = getPlaybackContext(create);
    void Promise.resolve(context.resume()).catch(() => {});
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, 22_050);
    source.connect(context.destination);
    source.start(0);
    return context.state;
  } catch {
    return "none";
  }
}

const domError = (name, message) => Object.assign(new Error(message), { name });

async function waitForRunning(context, timeoutMs, schedule, unschedule) {
  if (context.state === "running") return true;
  try { void Promise.resolve(context.resume()).catch(() => {}); } catch { /* Best effort. */ }
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      context.removeEventListener?.("statechange", onChange);
      if (timer !== null) unschedule(timer);
      resolve(value);
    };
    const onChange = () => { if (context.state === "running") finish(true); };
    context.addEventListener?.("statechange", onChange);
    timer = schedule(() => finish(context.state === "running"), timeoutMs);
    onChange();
  });
}

/**
 * @param {string} url Object URL of the received audio (fetched and decoded; the element-style `src` is never used).
 * @param {{ context?: object, fetchArrayBuffer?: (url: string) => Promise<ArrayBuffer>, setInterval?: Function,
 *   clearInterval?: Function, setTimeout?: Function, clearTimeout?: Function }} deps
 */
export function createWebAudioTrack(url, deps = {}) {
  const context = deps.context ?? getPlaybackContext();
  const fetchArrayBuffer = deps.fetchArrayBuffer ?? (async (target) => (await fetch(target)).arrayBuffer());
  const everyTick = deps.setInterval ?? ((callback, delay) => globalThis.setInterval(callback, delay));
  const stopTick = deps.clearInterval ?? ((id) => globalThis.clearInterval(id));
  const schedule = deps.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const unschedule = deps.clearTimeout ?? ((id) => globalThis.clearTimeout(id));
  const listeners = new Map();
  let buffer = null;
  let decoding = null;
  let source = null;
  let gain = null;
  let startedAt = 0;
  let tick = null;
  let paused = true;
  let ended = false;
  let disposed = false;
  let preload = "none";

  const emit = (type) => { for (const listener of [...(listeners.get(type) ?? [])]) listener({ type }); };
  const stopTicking = () => { if (tick !== null) { stopTick(tick); tick = null; } };

  const decode = () => {
    decoding ??= (async () => {
      const bytes = await fetchArrayBuffer(url);
      const decoded = await new Promise((resolve, reject) => {
        // Safari supports the promise form; the callback form covers older WebKit.
        const result = context.decodeAudioData(bytes, resolve, reject);
        if (result && typeof result.then === "function") result.then(resolve, reject);
      });
      buffer = decoded;
      emit("durationchange");
      return decoded;
    })();
    decoding.catch(() => {});
    return decoding;
  };

  const track = {
    get paused() { return paused; },
    get muted() { return false; },
    get volume() { return 1; },
    get readyState() { return buffer ? 4 : 0; },
    get duration() { return buffer ? buffer.duration : Number.NaN; },
    get currentTime() {
      if (!buffer) return 0;
      if (ended) return buffer.duration;
      if (paused || !source) return 0;
      return Math.min(buffer.duration, Math.max(0, context.currentTime - startedAt));
    },
    get preload() { return preload; },
    set preload(value) {
      preload = value;
      // Decoding ahead is what "preload" means for the next chunk.
      if (value !== "none" && !disposed) decode();
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    async play() {
      if (disposed) throw domError("InvalidStateError", "Track was released.");
      let decoded;
      try {
        decoded = await decode();
      } catch (error) {
        emit("error");
        throw domError("EncodingError", error?.message ?? "Audio could not be decoded.");
      }
      if (disposed) throw domError("AbortError", "Track was released.");
      if (!(await waitForRunning(context, deps.resumeTimeoutMs ?? CONTEXT_RESUME_TIMEOUT_MS, schedule, unschedule))) {
        throw domError("NotAllowedError", "The audio context is not running.");
      }
      if (disposed) throw domError("AbortError", "Track was released.");
      source = context.createBufferSource();
      source.buffer = decoded;
      gain = context.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(context.destination);
      const mine = source;
      source.onended = () => {
        if (source !== mine || paused) return;
        paused = true;
        ended = true;
        stopTicking();
        emit("timeupdate");
        emit("ended");
      };
      paused = false;
      ended = false;
      startedAt = context.currentTime;
      source.start(0);
      tick = everyTick(() => emit("timeupdate"), TRACK_TIME_UPDATE_MS);
      emit("playing");
    },
    pause() {
      stopTicking();
      if (source) {
        const stopping = source;
        paused = true;
        source = null;
        stopping.onended = null;
        try { stopping.stop(); } catch { /* Already stopped. */ }
        try { stopping.disconnect(); gain?.disconnect(); } catch { /* Already disconnected. */ }
      }
      paused = true;
    },
    removeAttribute() {},
    load() { track.pause(); },
    /** Final cleanup after a chunk: nothing may fire or play afterwards. */
    dispose() {
      disposed = true;
      track.pause();
      listeners.clear();
      buffer = null;
      decoding = null;
    },
  };
  return track;
}
