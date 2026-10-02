// Test doubles shared by the microphone engine, answer stream and handoff tests (not a test file itself).

export function frameBuffer(level, length = 1_600) {
  return new Float32Array(length).fill(level).buffer;
}

export class FakeTrack {
  constructor() {
    this.readyState = "live";
    this.muted = false;
    this.stopped = false;
    this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
  stop() { this.stopped = true; this.readyState = "ended"; }
  emit(type) {
    if (type === "ended") this.readyState = "ended";
    if (type === "mute") this.muted = true;
    this.listeners.get(type)?.();
  }
}

export class FakeWorklet {
  constructor({ autoFlush = true } = {}) {
    this.autoFlush = autoFlush;
    this.partialLevel = null;
    this.flushRequests = 0;
    this.port = { onmessage: null, postMessage: (message) => this.receive(message) };
    this.disconnected = false;
  }
  connect() {}
  disconnect() { this.disconnected = true; }
  receive(message) {
    if (message?.type !== "flush") return;
    this.flushRequests += 1;
    if (this.autoFlush) this.deliverFlush();
  }
  /** The worklet answers a flush with its partial frame (if any) and then "flushed". */
  deliverFlush() {
    if (this.partialLevel !== null) this.frame(this.partialLevel, 800);
    this.partialLevel = null;
    this.port.onmessage?.({ data: { type: "flushed" } });
  }
  frame(level, length = 1_600) {
    this.port.onmessage?.({ data: { type: "frame", samples: frameBuffer(level, length) } });
  }
}

/** Builds engine dependencies that record every acquisition. */
export function createFakeMicDeps({ autoFlush = true, rejectWith = null } = {}) {
  const log = { getUserMedia: 0, contexts: [], tracks: [], worklets: [], timers: [], recovered: [] };
  let nextTimer = 0;
  const deps = {
    log,
    isSupported: () => true,
    getUserMedia: async () => {
      log.getUserMedia += 1;
      if (deps.rejectWith) throw deps.rejectWith;
      const track = new FakeTrack();
      log.tracks.push(track);
      return { track, getTracks: () => [track], getAudioTracks: () => [track] };
    },
    createAudioContext: () => {
      const listeners = new Set();
      const context = {
        state: "running",
        destination: {},
        resumeCalls: 0,
        /** "ok": resume() reaches running; "never": it stays pending/stopped (a stuck interrupted session). */
        resumeBehavior: "ok",
        audioWorklet: { addModule: async () => {} },
        addEventListener: (type, listener) => { if (type === "statechange") listeners.add(listener); },
        removeEventListener: (type, listener) => { if (type === "statechange") listeners.delete(listener); },
        /** Moves the context to `next` and fires `statechange`, like the browser does. */
        setState: (next) => { context.state = next; for (const listener of [...listeners]) listener(); },
        resume: async () => {
          context.resumeCalls += 1;
          if (context.resumeBehavior === "ok" && context.state !== "closed") context.setState("running");
        },
        createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
        createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
        close: async () => { context.state = "closed"; },
      };
      log.contexts.push(context);
      return context;
    },
    createWorkletNode: () => {
      const worklet = new FakeWorklet({ autoFlush });
      log.worklets.push(worklet);
      return worklet;
    },
    workletUrl: "/pcm-capture-processor.js",
    stopTracks: (stream) => stream?.getTracks().forEach((track) => track.stop()),
    setTimeout: (callback) => { const id = ++nextTimer; log.timers.push({ id, callback }); return id; },
    clearTimeout: (id) => { log.timers = log.timers.filter((timer) => timer.id !== id); },
    onRecovered: (reason) => log.recovered.push(reason),
    rejectWith,
  };
  return deps;
}

export class FakeSocket {
  constructor() {
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.sent = [];
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }
  send(data) { this.sent.push(data); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  serverSays(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  serverClose(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
  json() { return this.sent.filter((item) => typeof item === "string").map((item) => JSON.parse(item)); }
  audioFrames() { return this.sent.filter((item) => typeof item !== "string"); }
  messageTypes() { return this.json().map((message) => message.type); }
}

export const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Fires every pending fake timer once (they are manual) and returns how many ran. */
export function runTimers(deps) {
  const pending = [...deps.log.timers];
  deps.log.timers = [];
  for (const timer of pending) timer.callback();
  return pending.length;
}
