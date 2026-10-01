/** The server rejected or could not complete the stream setup (`code` is the server's error code, never content). */
export class StreamSetupError extends Error {
  constructor(code) {
    super("Transcription stream setup failed.");
    this.code = code;
    this.kind = "setup";
  }
}

/** The socket did not become ready: kind is "timeout" or "connection". */
export class StreamConnectionError extends Error {
  constructor(kind) {
    super(`Transcription stream ${kind}.`);
    this.kind = kind;
  }
}

export const defaultReadyTimeoutMs = 5_000;
export const defaultMaxBufferedFrames = 100;
export const defaultMaxSocketBufferBytes = 512 * 1024;
const socketOpen = 1;

/**
 * Transport state machine of ONE answer's transcription socket (the component owns every message after `ready`).
 *
 *   idle -> connecting -> ready -> streaming -> (closed)        failed: connect() starts over
 *
 * `connect()` (pre-connect, while the interviewer still speaks) opens the socket, sends `start` and waits for
 * `ready`; it sends NO audio and NO level messages. `begin()` (answer window start) opens the audio gate: with a ready
 * socket it streams at once; otherwise frames pushed after `begin()` are buffered (bounded) until the socket is ready,
 * and a failed pre-connect is retried once with a fresh connection. Frames pushed before `begin()` are dropped.
 */
export function createAnswerStream(options) {
  const readyTimeoutMs = options.readyTimeoutMs ?? defaultReadyTimeoutMs;
  const maxBufferedFrames = options.maxBufferedFrames ?? defaultMaxBufferedFrames;
  const maxSocketBufferBytes = options.maxSocketBufferBytes ?? defaultMaxSocketBufferBytes;
  const schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const unschedule = options.clearTimeout ?? ((id) => clearTimeout(id));
  let state = "idle";
  let socket = null;
  let readyMessage = null;
  let connectPromise = null;
  let epoch = 0;
  let gateOpen = false;
  let buffer = [];
  let failedSent = false;

  function detach(target) {
    if (!target) return;
    target.onopen = null;
    target.onmessage = null;
    target.onerror = null;
    target.onclose = null;
  }

  function closeSocket(target, { sendCancel }) {
    if (!target) return;
    if (sendCancel && target.readyState === socketOpen) { try { target.send(JSON.stringify({ type: "cancel" })); } catch { /* Closing anyway. */ } }
    detach(target);
    try { target.close(); } catch { /* Already closed. */ }
  }

  function connect() {
    if (state === "closed") return Promise.reject(new StreamConnectionError("connection"));
    if (connectPromise && state !== "failed") return connectPromise;
    const myEpoch = ++epoch;
    state = "connecting";
    readyMessage = null;
    const promise = (async () => {
      let start;
      try {
        start = await options.buildStartMessage();
      } catch (error) {
        if (myEpoch === epoch) state = "failed";
        throw error;
      }
      if (myEpoch !== epoch) throw new StreamConnectionError("connection");
      const ws = options.openSocket();
      ws.binaryType = "arraybuffer";
      socket = ws;
      return new Promise((resolve, reject) => {
        const fail = (error) => {
          unschedule(timer);
          if (myEpoch !== epoch) return;
          state = "failed";
          closeSocket(ws, { sendCancel: false });
          reject(error);
        };
        const timer = schedule(() => fail(new StreamConnectionError("timeout")), readyTimeoutMs);
        ws.onopen = () => ws.send(JSON.stringify(start));
        ws.onerror = () => fail(new StreamConnectionError("connection"));
        ws.onmessage = (event) => {
          if (myEpoch !== epoch) return;
          let message;
          try { message = JSON.parse(String(event.data)); } catch { return; }
          if (state === "connecting") {
            if (message?.type === "ready") {
              unschedule(timer);
              state = "ready";
              readyMessage = message;
              resolve(message);
            } else if (message?.type === "error") fail(new StreamSetupError(message.code));
            return;
          }
          if (!gateOpen) {
            // An idle pre-connected socket that reports an error is unusable; begin() will reconnect.
            if (message?.type === "error") { state = "failed"; closeSocket(ws, { sendCancel: false }); }
            return;
          }
          options.onMessage?.(message, ws);
        };
        ws.onclose = (event) => {
          if (myEpoch !== epoch) return;
          if (state === "connecting") { fail(new StreamConnectionError("connection")); return; }
          if (state === "closed") return;
          if (!gateOpen) { state = "failed"; return; }
          options.onClose?.(event, ws);
        };
      });
    })();
    connectPromise = promise;
    promise.catch(() => {});
    return promise;
  }

  function sendFrame(frame) {
    if (!socket || socket.readyState !== socketOpen) { options.onFailure?.("closed"); return false; }
    if (socket.bufferedAmount > maxSocketBufferBytes) { options.onFailure?.("slow"); return false; }
    socket.send(options.encodeFrame(frame.samples));
    socket.send(JSON.stringify({ type: "level", value: frame.level }));
    return true;
  }

  function startStreaming() {
    state = "streaming";
    const pending = buffer;
    buffer = [];
    for (const frame of pending) { if (!sendFrame(frame)) return; }
  }

  return {
    get state() { return state; },
    get socket() { return socket; },
    get readyMessage() { return readyMessage; },
    get gateOpen() { return gateOpen; },
    connect,
    /**
     * Opens the audio gate (the answer window started). Resolves once streaming: immediately when the socket is
     * already ready (`preconnected: true`), otherwise after connecting (retrying once if a pre-connect failed).
     */
    async begin() {
      if (state === "closed") throw new StreamConnectionError("connection");
      gateOpen = true;
      if (state === "ready") {
        startStreaming();
        return { preconnected: true, readyMessage };
      }
      const wasPreconnecting = state === "connecting";
      try {
        await connect();
      } catch (error) {
        if (!wasPreconnecting || state === "closed") throw error;
        await connect();
      }
      if (state === "closed") throw new StreamConnectionError("connection");
      startStreaming();
      return { preconnected: false, readyMessage };
    },
    /** One captured frame. Dropped before `begin()`; buffered (bounded) until ready; streamed afterwards. */
    pushFrame(frame) {
      if (!gateOpen || state === "closed" || state === "failed") return;
      if (state === "streaming") { sendFrame(frame); return; }
      buffer.push(frame);
      if (buffer.length > maxBufferedFrames && !failedSent) { failedSent = true; options.onFailure?.("buffer"); }
    },
    /** Cancels the answer on the server (if open), detaches and closes the socket, drops buffered frames. */
    cancel() {
      epoch += 1;
      const target = socket;
      state = "closed";
      buffer = [];
      closeSocket(target, { sendCancel: true });
    },
    /** Hands the socket over (e.g. to the assessment registry): no further traffic is owned by this stream. */
    release() {
      epoch += 1;
      state = "closed";
      buffer = [];
      detach(socket);
    },
  };
}
