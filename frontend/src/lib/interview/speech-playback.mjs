export function synthesizeInterviewerQuestion(text, options) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetcher = options.fetcher ?? fetch;
  const makeAudio = options.makeAudio ?? ((url) => new Audio(url));
  const createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  const schedule = options.setTimeout ?? ((callback, delay) => window.setTimeout(callback, delay));
  const unschedule = options.clearTimeout ?? ((id) => window.clearTimeout(id));
  let audio = null;
  let objectUrl = null;
  let cancelled = false;
  let timedOut = false;
  let timeoutId = null;
  let settlePlayback = null;
  let removeAudioListeners = null;

  const cleanup = () => {
    removeAudioListeners?.();
    removeAudioListeners = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute?.("src");
      if (typeof audio.load === "function") audio.load();
    }
    audio = null;
    if (objectUrl) revokeObjectUrl(objectUrl);
    objectUrl = null;
    if (timeoutId !== null) unschedule(timeoutId);
    timeoutId = null;
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    controller.abort();
    settlePlayback?.("cancelled");
    cleanup();
  };

  const promise = (async () => {
    timeoutId = schedule(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetcher(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (timeoutId !== null) unschedule(timeoutId);
      timeoutId = null;

      if (cancelled) return { status: "cancelled" };
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        return {
          status: "unavailable",
          message: data?.error?.message ?? "O áudio não está disponível agora. Você pode continuar sem ele.",
        };
      }

      objectUrl = createObjectUrl(await response.blob());
      if (cancelled) return { status: "cancelled" };
      audio = makeAudio(objectUrl);

      const playbackEnded = new Promise((resolve, reject) => {
        const onEnded = () => resolve("ended");
        const onError = () => reject(new Error("Audio playback failed."));
        audio.addEventListener("ended", onEnded, { once: true });
        audio.addEventListener("error", onError, { once: true });
        removeAudioListeners = () => {
          audio?.removeEventListener("ended", onEnded);
          audio?.removeEventListener("error", onError);
        };
        settlePlayback = resolve;
      });

      await audio.play();
      const outcome = await playbackEnded;
      if (cancelled || outcome === "cancelled") return { status: "cancelled" };
      return { status: "completed" };
    } catch {
      if (cancelled) return { status: "cancelled" };
      return {
        status: "unavailable",
        message: timedOut
          ? "O áudio demorou demais para responder. Você pode continuar sem ele."
          : "O áudio não está disponível agora. Você pode continuar sem ele.",
      };
    } finally {
      cleanup();
    }
  })();

  return { promise, cancel };
}
