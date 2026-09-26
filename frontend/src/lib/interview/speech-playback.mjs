export function composeOpeningUtterance(introduction, firstQuestion) {
  return [introduction.trim(), firstQuestion.trim()].filter(Boolean).join(" ");
}

export function composeContextualOpening(config, firstQuestion) {
  const role = config.role?.trim() || "the role";
  const seniorityLabels = { junior: "junior", "mid-level": "mid-level", senior: "senior", staff: "staff-level" };
  const focusLabels = {
    "technical-depth": "technical depth",
    communication: "communication and clarity",
    behavioral: "behavioral questions",
    mixed: "balanced practice",
  };
  const seniority = seniorityLabels[config.seniority?.trim()];
  const focus = focusLabels[config.focus?.trim()];
  const minutes = Number.parseInt(config.duration, 10) || 5;
  const roleDescription = seniority ? `a ${seniority} ${role} role` : `the ${role} role`;
  const focusLine = focus ? `We’ll focus on ${focus}.` : "I’ll ask about your experience and decisions.";
  return `Thanks for joining. We have about ${minutes} minutes for an interview for ${roleDescription}. ${focusLine} Take your time. ${firstQuestion.trim()}`;
}

export function composeAcknowledgedQuestion(acknowledgement, question) {
  return [acknowledgement?.trim(), question.trim()].filter(Boolean).join(" ");
}

export function splitInterviewerSpeech(text) {
  const content = text.trim();
  if (!content) return [];

  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(content)]
      .map(({ segment }) => segment.trim())
      .filter(Boolean);
  }

  return (content.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [content])
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function resolveInterviewerCaption({ audioEnabled, isSpeaking, playbackFailed, activeSegment, firstSegment, fallbackText, questionPrompt }) {
  if (!audioEnabled || playbackFailed) return fallbackText;
  if (isSpeaking) return activeSegment || firstSegment || questionPrompt;
  return questionPrompt;
}

export function synthesizeInterviewerQuestion(text, options) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const playbackTimeoutMs = options.playbackTimeoutMs
    ?? Math.min(45_000, Math.max(12_000, text.trim().split(/\s+/).length * 800));
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
  let removeAudioListeners = null;
  let resolveTimeout;
  let resolveCancellation;

  const timeoutResult = new Promise((resolve) => { resolveTimeout = resolve; });
  const cancellationResult = new Promise((resolve) => { resolveCancellation = resolve; });

  const scheduleTimeout = (delay, message) => {
    if (timeoutId !== null) unschedule(timeoutId);
    timeoutId = schedule(() => {
      timedOut = true;
      controller.abort();
      resolveTimeout({ status: "unavailable", message });
    }, delay);
  };

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
    resolveCancellation({ status: "cancelled" });
    cleanup();
  };

  const playbackWork = async () => {
    try {
      scheduleTimeout(timeoutMs, "O áudio demorou demais para responder. Você pode continuar sem ele.");
      const response = await fetcher(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (cancelled) return { status: "cancelled" };
      if (timedOut) return { status: "unavailable", message: "O áudio demorou demais para responder. Você pode continuar sem ele." };
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        return {
          status: "unavailable",
          message: data?.error?.message ?? "O áudio não está disponível agora. Você pode continuar sem ele.",
        };
      }

      const blob = await response.blob();
      if (cancelled) return { status: "cancelled" };
      if (timedOut) return { status: "unavailable", message: "O áudio demorou demais para responder. Você pode continuar sem ele." };
      if (timeoutId !== null) unschedule(timeoutId);
      timeoutId = null;
      objectUrl = createObjectUrl(blob);
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
      });

      scheduleTimeout(playbackTimeoutMs, "A reprodução do áudio demorou demais. Você pode continuar sem ele.");
      const outcome = await Promise.race([
        Promise.resolve(audio.play()).then(() => playbackEnded),
        playbackEnded,
        timeoutResult,
        cancellationResult,
      ]);
      if (cancelled || outcome.status === "cancelled") return { status: "cancelled" };
      if (outcome.status === "unavailable") return outcome;
      return { status: "completed" };
    } catch {
      if (cancelled) return { status: "cancelled" };
      if (timedOut) return { status: "unavailable", message: "O áudio demorou demais para responder. Você pode continuar sem ele." };
      return {
        status: "unavailable",
        message: "O áudio não está disponível agora. Você pode continuar sem ele.",
      };
    } finally {
      cleanup();
    }
  };

  const promise = Promise.race([playbackWork(), timeoutResult, cancellationResult]).finally(cleanup);

  return { promise, cancel };
}

export function playInterviewerSegments(segments, options) {
  let cancelled = false;
  let activePlayback = null;

  const promise = (async () => {
    for (const segment of segments) {
      if (cancelled) return { status: "cancelled" };
      options.onSegment?.(segment);
      activePlayback = synthesizeInterviewerQuestion(segment, options);
      const result = await activePlayback.promise;
      activePlayback = null;
      if (result.status !== "completed") return result;
    }
    return { status: "completed" };
  })();

  return {
    promise,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      activePlayback?.cancel();
      activePlayback = null;
    },
  };
}
