const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export function chooseAudioMimeType(mediaRecorder = globalThis.MediaRecorder) {
  if (!mediaRecorder) return "";
  return MIME_TYPES.find((type) => mediaRecorder.isTypeSupported?.(type)) ?? "";
}

export function createVoiceRecorder({
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderClass = globalThis.MediaRecorder,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  maxSeconds = 20,
  minDurationMs = 600,
  onStateChange = () => {},
} = {}) {
  let state = "idle";
  let stream = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let limitTimer = null;
  let resultPromise = null;
  let resolveResult;
  let cancelled = false;

  const setState = (next) => { state = next; onStateChange(next); };
  const release = () => {
    if (limitTimer !== null) clearTimeoutFn(limitTimer);
    limitTimer = null;
    for (const track of stream?.getTracks?.() ?? []) track.stop();
    stream = null;
  };

  const stop = () => {
    if (state !== "recording") return resultPromise ?? Promise.resolve(null);
    setState("processing");
    if (recorder?.state === "recording") recorder.stop();
    return resultPromise;
  };

  const cancel = () => {
    if (state === "idle") return;
    release();
    cancelled = true;
    const activeRecorder = recorder;
    recorder = null;
    if (activeRecorder?.state === "recording") activeRecorder.stop();
    chunks = [];
    setState("idle");
    resolveResult?.(null);
    resolveResult = null;
    resultPromise = null;
  };

  const start = async () => {
    if (state === "requesting" || state === "recording" || state === "processing") return null;
    if (!mediaDevices?.getUserMedia || !MediaRecorderClass) {
      setState("error");
      throw new Error("VOICE_RECORDING_UNAVAILABLE");
    }
    setState("requesting");
    try {
      stream = await mediaDevices.getUserMedia({ audio: true });
      const mimeType = chooseAudioMimeType(MediaRecorderClass);
      recorder = new MediaRecorderClass(stream, mimeType ? { mimeType } : undefined);
      cancelled = false;
      chunks = [];
      startedAt = now();
      resultPromise = new Promise((resolve) => { resolveResult = resolve; });
      recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) chunks.push(event.data); });
      recorder.addEventListener("error", () => {
        release(); setState("error"); resolveResult?.(null); resolveResult = null;
      }, { once: true });
      recorder.addEventListener("stop", () => {
        if (cancelled) return;
        const durationMs = Math.max(0, Math.round(now() - startedAt));
        const blob = new Blob(chunks, { type: mimeType || recorder.mimeType || "application/octet-stream" });
        const result = durationMs < minDurationMs ? null : { blob, mimeType: blob.type, durationMs };
        release();
        setState(result ? "idle" : "error");
        resolveResult?.(result);
        resolveResult = null;
      }, { once: true });
      recorder.start();
      setState("recording");
      limitTimer = setTimeoutFn(() => { void stop(); }, maxSeconds * 1000);
      return null;
    } catch (error) {
      release(); setState("error"); throw error;
    }
  };

  return { start, stop, cancel, completed: () => resultPromise ?? Promise.resolve(null), get state() { return state; } };
}
