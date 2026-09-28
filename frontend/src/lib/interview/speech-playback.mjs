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
  const roleDescription = seniority ? `the ${seniority} ${role} role` : `the ${role} role`;
  const focusLine = focus ? `We’ll focus on ${focus} for ${roleDescription}.` : `I’ll ask about your experience and decisions for ${roleDescription}.`;
  return `Thanks for joining me. We have about ${minutes} minutes today. ${focusLine} ${firstQuestion.trim()}`;
}

export function composeAcknowledgedQuestion(acknowledgement, question) {
  return [acknowledgement?.trim(), question.trim()].filter(Boolean).join(" ");
}

export function composeInterviewClosing() {
  return "Thanks for your time today. That brings us to the end of the interview. I’ll prepare your feedback now.";
}

export function resolveSkippedQuestion(question) {
  return { question, acknowledgement: "" };
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

const speechFlights = new Map();

function acquireSpeechBlob(options, text) {
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options.requestBody ?? { text }),
  };
  const key = JSON.stringify([options.endpoint, request.method, request.headers, request.body]);
  let flight = speechFlights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const fetcher = options.fetcher ?? fetch;
    flight = {
      controller,
      consumers: new Set(),
      settled: false,
      promise: Promise.resolve().then(async () => {
        const response = await fetcher(options.endpoint, { ...request, signal: controller.signal });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          const error = new Error(data?.error?.message ?? "O áudio não está disponível agora. Você pode continuar sem ele.");
          error.isSpeechResponseError = true;
          throw error;
        }
        return response.blob();
      }),
    };
    speechFlights.set(key, flight);
    flight.promise.finally(() => {
      flight.settled = true;
      if (speechFlights.get(key) === flight) speechFlights.delete(key);
    }).catch(() => {});
  }

  const consumer = {};
  flight.consumers.add(consumer);
  let released = false;
  return {
    promise: flight.promise,
    release(deferAbort = true) {
      if (released) return;
      released = true;
      flight.consumers.delete(consumer);
      // React Strict Mode immediately remounts effects; let the replacement
      // consumer attach before aborting a flight whose prior consumer cleaned up.
      const abortIfUnused = () => {
        if (!flight.settled && flight.consumers.size === 0) {
          flight.controller.abort();
          if (speechFlights.get(key) === flight) speechFlights.delete(key);
        }
      };
      if (deferAbort) queueMicrotask(abortIfUnused);
      else abortIfUnused();
    },
  };
}

export function synthesizeInterviewerQuestion(text, options) {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const playbackTimeoutMs = options.playbackTimeoutMs
    ?? Math.min(45_000, Math.max(12_000, text.trim().split(/\s+/).length * 800));
  const makeAudio = options.makeAudio ?? ((url) => new Audio(url));
  const createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  const schedule = options.setTimeout ?? ((callback, delay) => window.setTimeout(callback, delay));
  const unschedule = options.clearTimeout ?? ((id) => window.clearTimeout(id));
  let audio = null;
  let objectUrl = null;
  let flightLease = null;
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
      flightLease?.release(false);
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
    flightLease?.release();
    flightLease = null;
    if (timeoutId !== null) unschedule(timeoutId);
    timeoutId = null;
  };

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    resolveCancellation({ status: "cancelled" });
    cleanup();
  };

  const playbackWork = async () => {
    try {
      scheduleTimeout(timeoutMs, "O áudio demorou demais para responder. Você pode continuar sem ele.");
      flightLease = acquireSpeechBlob(options, text);
      const blob = await flightLease.promise;
      if (cancelled) return { status: "cancelled" };
      if (timedOut) return { status: "unavailable", message: "O áudio demorou demais para responder. Você pode continuar sem ele." };
      if (cancelled) return { status: "cancelled" };
      if (timedOut) return { status: "unavailable", message: "O áudio demorou demais para responder. Você pode continuar sem ele." };
      if (timeoutId !== null) unschedule(timeoutId);
      timeoutId = null;
      objectUrl = createObjectUrl(blob);
      audio = makeAudio(objectUrl);

      const playbackEnded = new Promise((resolve, reject) => {
        const onEnded = () => resolve("ended");
        const onError = () => reject(new Error("Audio playback failed."));
        const captionSegments = options.captionSegments?.filter(Boolean) ?? [];
        const totalWords = captionSegments.reduce((total, segment) => total + segment.split(/\s+/u).filter(Boolean).length, 0);
        const onTimeUpdate = () => {
          if (!captionSegments.length || !Number.isFinite(audio?.duration) || audio.duration <= 0 || totalWords === 0) return;
          const playedRatio = Math.min(1, audio.currentTime / audio.duration);
          const playedWords = playedRatio * totalWords;
          let boundary = 0;
          let segmentIndex = captionSegments.length - 1;
          for (let index = 0; index < captionSegments.length; index += 1) {
            boundary += captionSegments[index].split(/\s+/u).filter(Boolean).length;
            if (playedWords < boundary) { segmentIndex = index; break; }
          }
          if (!cancelled) options.onSegment?.(captionSegments[segmentIndex]);
        };
        if (captionSegments.length && !cancelled) options.onSegment?.(captionSegments[0]);
        audio.addEventListener("ended", onEnded, { once: true });
        audio.addEventListener("error", onError, { once: true });
        audio.addEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("durationchange", onTimeUpdate);
        removeAudioListeners = () => {
          audio?.removeEventListener("ended", onEnded);
          audio?.removeEventListener("error", onError);
          audio?.removeEventListener("timeupdate", onTimeUpdate);
          audio?.removeEventListener("durationchange", onTimeUpdate);
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
    } catch (error) {
      if (cancelled) return { status: "cancelled" };
      if (timedOut) return { status: "unavailable", message: "O áudio demorou demais para responder. Você pode continuar sem ele." };
      return {
        status: "unavailable",
        message: error?.isSpeechResponseError && error.message
          ? error.message
          : "O áudio não está disponível agora. Você pode continuar sem ele.",
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

  const utterance = segments.map((segment) => segment.trim()).filter(Boolean);
  const promise = (async () => {
    if (cancelled) return { status: "cancelled" };
    if (!utterance.length) return { status: "completed" };
    activePlayback = synthesizeInterviewerQuestion(utterance.join(" "), { ...options, captionSegments: utterance });
    const result = await activePlayback.promise;
    activePlayback = null;
    return result;
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
