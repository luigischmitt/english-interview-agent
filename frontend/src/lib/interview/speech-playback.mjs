export function composeOpeningUtterance(introduction, firstQuestion) {
  return [introduction.trim(), firstQuestion.trim()].filter(Boolean).join(" ");
}

export function composeContextualOpening(config, firstQuestion) {
  const role = config.role?.trim() || "target";
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
  const roleDescription = `${seniority ? `${seniority} ` : ""}${role} role`;
  const focusDescription = focus ?? "your experience and decisions";
  return `We have about ${minutes} minutes for your ${roleDescription}, focusing on ${focusDescription}. ${firstQuestion.trim()}`;
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
// Finished blobs of prepared (pre-synthesized) utterances, reusable by an identical request for a short time.
const retainedSpeechBlobs = new Map();

function retainSpeechBlob(key, blob, retainMs) {
  const previous = retainedSpeechBlobs.get(key);
  if (previous) clearTimeout(previous.timer);
  const timer = setTimeout(() => { if (retainedSpeechBlobs.get(key)?.blob === blob) retainedSpeechBlobs.delete(key); }, retainMs);
  timer.unref?.();
  retainedSpeechBlobs.set(key, { blob, timer });
}

/** Test hook: forgets retained blobs and their timers. */
export function clearRetainedSpeechBlobs() {
  for (const entry of retainedSpeechBlobs.values()) clearTimeout(entry.timer);
  retainedSpeechBlobs.clear();
}

/** Test hook: aborts and forgets every in-flight speech request (e.g. ones left running in the background). */
export function resetSpeechFlights() {
  for (const flight of speechFlights.values()) flight.controller.abort();
  speechFlights.clear();
}

function speechRequestFor(options, text) {
  const request = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options.requestBody ?? { text }),
  };
  return { request, key: JSON.stringify([options.endpoint, request.method, request.headers, request.body]) };
}

function acquireSpeechBlob(options, text) {
  const { request, key } = speechRequestFor(options, text);
  const retained = retainedSpeechBlobs.get(key);
  if (retained) return { promise: Promise.resolve(retained.blob), release() {} };
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
          error.status = response.status;
          throw error;
        }
        const blob = await response.blob();
        if (options.retainMs > 0 && !controller.signal.aborted) retainSpeechBlob(key, blob, options.retainMs);
        return blob;
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

/**
 * Advances captions against the playback progress of one audio track (estimated by word count). Units are
 * `{ caption, text }`: `text` is what is spoken (its words weigh the progress), `caption` is what is shown, so a
 * sentence split into two audio parts keeps showing the whole sentence.
 */
function createCaptionUpdater(units, getAudio, isCancelled, onSegment) {
  const wordCount = (segment) => segment.split(/\s+/u).filter(Boolean).length;
  const totalWords = units.reduce((total, unit) => total + wordCount(unit.text), 0);
  return () => {
    const audio = getAudio();
    if (!units.length || !Number.isFinite(audio?.duration) || audio.duration <= 0 || totalWords === 0) return;
    const playedWords = Math.min(1, audio.currentTime / audio.duration) * totalWords;
    let boundary = 0;
    let segmentIndex = units.length - 1;
    for (let index = 0; index < units.length; index += 1) {
      boundary += wordCount(units[index].text);
      if (playedWords < boundary) { segmentIndex = index; break; }
    }
    if (!isCancelled()) onSegment?.(units[segmentIndex].caption);
  };
}

// Longest wait for the interviewer audio (the first chunk, or a later one) before giving up on voice for the utterance.
// The backend budget is 15 s (own Kokoro, then the OpenRouter hedge); this leaves time for the network and body transfer.
export const FIRST_AUDIO_TIMEOUT_MS = 20_000;
export const speechUnavailableMessage = "Não conseguimos reproduzir a voz do entrevistador. Leia a pergunta e responda normalmente.";

// A rejected session is not a provider problem: the (Portuguese) session message is shown instead of the generic one.
const isAuthError = (error) => Boolean(error?.isUnauthenticated || (error?.isSpeechResponseError && (error.status === 401 || error.status === 403)));

const unavailableMessages = {
  default: speechUnavailableMessage,
  network: speechUnavailableMessage,
  playback: speechUnavailableMessage,
};

// A session problem keeps its own (Portuguese) message; every other failure shows the generic one.
const unavailableMessageFor = (error) => (isAuthError(error) && error.message ? error.message : unavailableMessages.default);

export function synthesizeInterviewerQuestion(text, options) {
  const firstAudioTimeoutMs = options.firstAudioTimeoutMs ?? FIRST_AUDIO_TIMEOUT_MS;
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

  const scheduleTimeout = (delay, message, result = { status: "unavailable", message }) => {
    if (timeoutId !== null) unschedule(timeoutId);
    timeoutId = schedule(() => {
      timedOut = true;
      flightLease?.release(false);
      resolveTimeout(result);
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
      scheduleTimeout(firstAudioTimeoutMs, unavailableMessages.network);
      options.onSynthesisStarted?.();
      flightLease = acquireSpeechBlob(options, text);
      const blob = await flightLease.promise;
      options.onSynthesisCompleted?.();
      if (cancelled) return { status: "cancelled" };
      if (timedOut) return { status: "unavailable", message: unavailableMessages.network };
      if (timeoutId !== null) unschedule(timeoutId);
      timeoutId = null;
      objectUrl = createObjectUrl(blob);
      audio = makeAudio(objectUrl);

      const playbackEnded = new Promise((resolve, reject) => {
        const onEnded = () => resolve("ended");
        const onError = () => reject(new Error("Audio playback failed."));
        const onPlaying = () => options.onPlaybackStarted?.();
        const captionSegments = options.captionSegments?.filter(Boolean) ?? [];
        const captionUnits = captionSegments.map((segment) => ({ caption: segment, text: segment }));
        const onTimeUpdate = createCaptionUpdater(captionUnits, () => audio, () => cancelled, options.onSegment);
        if (captionSegments.length && !cancelled) options.onSegment?.(captionSegments[0]);
        audio.addEventListener("ended", onEnded, { once: true });
        audio.addEventListener("error", onError, { once: true });
        audio.addEventListener("playing", onPlaying, { once: true });
        audio.addEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("durationchange", onTimeUpdate);
        removeAudioListeners = () => {
          audio?.removeEventListener("ended", onEnded);
          audio?.removeEventListener("error", onError);
          audio?.removeEventListener("playing", onPlaying);
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
      return { status: "unavailable", message: unavailableMessageFor(error) };
    } finally {
      cleanup();
    }
  };

  const promise = Promise.race([playbackWork(), timeoutResult, cancellationResult]).finally(cleanup);

  return { promise, cancel };
}

// Sentences shorter than this are merged with the next one so no request is tiny; a sentence is never split
// (except the first one, see `firstChunkSplitThreshold`).
export const minimumChunkCharacters = 40;
// Every chunk after the first is at most this long: a longer sentence is split (see `splitSentence`) and a merged group never
// grows past it. Kokoro synthesizes ~80 characters in ~2 s, so each chunk is ready before the previous one finishes playing.
// Only a sentence with no usable space stays whole.
export const maximumChunkCharacters = 80;
// An opening of at most this many characters stays one request; a longer one makes its first sentence its own chunk.
export const firstChunkSplitThreshold = 70;
// The first chunk is at most this long whenever the first sentence is longer (Kokoro synthesis time grows with length).
export const firstChunkMaximum = 60;
/** How far a clause or conjunction split may exceed the chunk cap. */
const naturalBoundarySlack = 10;
export const firstChunkPartMinimum = 20;
// A head cut before a conjunction or at a word boundary is at least this long.
export const firstChunkWordPartMinimum = 25;
// Later pieces of a split sentence are at least this long where possible.
export const laterChunkPartMinimum = 25;
// The final chunk reports it is ending once at most this much of it remains (or at its start when it is shorter).
export const finalChunkLeadMs = 3_000;
// Chunk N+1 is requested only once chunk N's audio has arrived: one network synthesis in flight per utterance.
export const maxConcurrentChunkRequests = 1;

const clauseBoundaries = [", ", "; ", " \u2014 ", ": "];

const conjunctionBoundaries = [" because ", " so ", " and ", " but ", " which ", " when ", " while ", " where ", " that ", " so that ", " to "];

/**
 * Splits a sentence longer than `cap` so the head is at most `cap` long, or returns null:
 * 1. the first clause boundary leaving a head of `clauseMinimum`..cap characters; else
 * 2. before the latest conjunction/relative word leaving a 25..cap character head; else
 * 3. at the last space leaving a 25..cap character head.
 */
function splitSentence(sentence, cap, clauseMinimum) {
  if (sentence.length <= cap) return null;
  // A clause or conjunction boundary sounds natural, so it may overshoot the cap slightly; a bare word cut may not.
  const naturalCap = cap + naturalBoundarySlack;
  let best = null;
  for (const boundary of clauseBoundaries) {
    let from = 0;
    for (;;) {
      const at = sentence.indexOf(boundary, from);
      if (at === -1) break;
      from = at + 1;
      const head = (boundary === " \u2014 " ? sentence.slice(0, at) : sentence.slice(0, at + boundary.trimEnd().length)).trim();
      const tail = sentence.slice(at + boundary.length).trim();
      if (head.length > naturalCap) break;
      if (head.length < clauseMinimum || !tail) continue;
      if (!best || at < best.at) best = { at, head, tail };
      break;
    }
  }
  if (best) return { head: best.head, tail: best.tail };
  const lower = sentence.toLowerCase();
  let latest = -1;
  for (const word of conjunctionBoundaries) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) {
      if (at > naturalCap) break;
      if (at >= firstChunkWordPartMinimum && at > latest && sentence.slice(at + 1).trim()) latest = at;
    }
  }
  if (latest === -1) {
    const at = sentence.lastIndexOf(" ", cap);
    if (at < firstChunkWordPartMinimum || !sentence.slice(at + 1).trim()) return null;
    latest = at;
  }
  return { head: sentence.slice(0, latest).trim(), tail: sentence.slice(latest + 1).trim() };
}

/** Splits a sentence recursively into pieces of at most `cap` characters (a piece with no usable space stays whole). */
function splitToFit(sentence, cap) {
  const split = splitSentence(sentence, cap, laterChunkPartMinimum);
  return split ? [split.head, ...splitToFit(split.tail, cap)] : [sentence];
}

/**
 * Groups sentences into synthesis chunks: `text` is what is sent to the voice; `sentences` are the caption sentences
 * (always whole); `units` pair each spoken piece with its caption. Each chunk is at least `minimumChunkCharacters`
 * long (except a lone short utterance, a short first part or a group that merging would push past
 * `maximumChunkCharacters`). A first sentence over 60 characters becomes a first chunk of at most 60 characters plus a remainder.
 */
export function groupInterviewerSentences(segments) {
  const sentences = segments.map((segment) => segment.trim()).filter(Boolean);
  const chunks = [];
  let pending = [];
  let locked = false;
  const lengthOf = (units) => units.map((unit) => unit.text).join(" ").length;
  const flush = () => { chunks.push({ units: pending, locked }); pending = []; locked = false; };
  const totalLength = sentences.join(" ").length;

  sentences.forEach((sentence, index) => {
    let units = splitToFit(sentence, maximumChunkCharacters).map((text) => ({ text, caption: sentence }));
    const split = index === 0 ? splitSentence(sentence, firstChunkMaximum, firstChunkPartMinimum) : null;
    if (split) {
      chunks.push({ units: [{ text: split.head, caption: sentence }], locked: true });
      units = splitToFit(split.tail, maximumChunkCharacters).map((text) => ({ text, caption: sentence }));
    } else if (index === 0 && totalLength > firstChunkSplitThreshold) {
      // The first sentence (often a short bridge) is synthesized alone so the first audio arrives fast.
      chunks.push({ units: [{ text: sentence, caption: sentence }], locked: true });
      return;
    }
    for (const unit of units) {
      if (pending.length && lengthOf([...pending, unit]) > maximumChunkCharacters) flush();
      pending.push(unit);
      if (lengthOf(pending) >= minimumChunkCharacters) flush();
    }
  });
  if (pending.length) {
    const previous = chunks[chunks.length - 1];
    if (previous && !previous.locked && lengthOf([...previous.units, ...pending]) <= maximumChunkCharacters) previous.units.push(...pending);
    else chunks.push({ units: pending, locked: false });
  }
  return chunks.map(({ units }) => ({
    text: units.map((unit) => unit.text).join(" "),
    sentences: units.map((unit) => unit.caption).filter((caption, index, all) => index === 0 || caption !== all[index - 1]),
    units,
  }));
}

/**
 * Requests the chunks one at a time, in order: chunk N+1 starts as soon as chunk N's audio has arrived (not when it
 * finishes playing). Leases dedupe against prewarmed blobs.
 */
function requestChunks(chunks, options) {
  let active = 0;
  let next = 0;
  let stopped = false;
  const entries = chunks.map((chunk) => {
    const entry = { chunk, lease: null, settled: false };
    entry.promise = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
    entry.promise.catch(() => {});
    return entry;
  });
  const pump = () => {
    while (!stopped && active < maxConcurrentChunkRequests && next < entries.length) {
      const entry = entries[next++];
      active += 1;
      entry.lease = acquireSpeechBlob(options, entry.chunk.text);
      entry.lease.promise.then(entry.resolve, (error) => { stopped = true; entry.reject(error); }).then(() => { entry.settled = true; active -= 1; pump(); });
      if (next === 1) options.onSynthesisStarted?.();
    }
  };
  pump();
  return {
    entries,
    stop() {
      stopped = true;
      for (const entry of entries) entry.lease?.release(false);
    },
  };
}


/**
 * Plays an utterance chunk by chunk (see `groupInterviewerSentences`). Chunk 1 is requested right away and each
 * later chunk once the previous one has arrived (one request in flight), so chunk 1 starts as soon as it arrives and
 * the next chunk is decoded ahead (preloaded Audio) to avoid audible gaps. A failed
 * chunk ends playback as "unavailable" and the caller keeps the text visible; cancelling aborts pending requests.
 */
export function playInterviewerSegments(segments, options) {
  const chunks = groupInterviewerSentences(segments);
  const makeAudio = options.makeAudio ?? ((url) => new Audio(url));
  const createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  const schedule = options.setTimeout ?? ((callback, delay) => window.setTimeout(callback, delay));
  const unschedule = options.clearTimeout ?? ((id) => window.clearTimeout(id));
  const firstAudioTimeoutMs = options.firstAudioTimeoutMs ?? FIRST_AUDIO_TIMEOUT_MS;
  let cancelled = false;
  let requests = null;
  let stopPlaying = null;
  const prepared = [];
  let resolveCancellation;
  const cancellationResult = new Promise((resolve) => { resolveCancellation = resolve; });

  const withDeadline = (promise, delay, message) => {
    let id = null;
    const deadline = new Promise((_resolve, reject) => {
      id = schedule(() => reject(Object.assign(new Error(message), { isSpeechTimeout: true })), delay);
    });
    return Promise.race([promise, deadline]).finally(() => { if (id !== null) unschedule(id); });
  };

  // Waits for a chunk's blob and builds its Audio element so the browser can buffer it before it is needed.
  const prepare = async (index) => {
    const blob = await requests.entries[index].promise;
    if (index === 0) options.onSynthesisCompleted?.();
    if (cancelled) throw Object.assign(new Error("cancelled"), { isCancelled: true });
    const item = { url: createObjectUrl(blob), audio: null };
    prepared.push(item);
    item.audio = makeAudio(item.url);
    try { item.audio.preload = "auto"; } catch { /* Best effort. */ }
    return item;
  };

  const release = (item) => {
    const audio = item.audio;
    if (audio) {
      audio.pause();
      audio.removeAttribute?.("src");
      if (typeof audio.load === "function") audio.load();
    }
    item.audio = null;
    if (item.url) revokeObjectUrl(item.url);
    item.url = null;
  };

  const handoffLeadMs = options.finalChunkLeadMs ?? finalChunkLeadMs;
  let finalChunkAnnounced = false;
  const playChunk = (item, chunk, isFirst, isLast) => new Promise((resolve, reject) => {
    const audio = item.audio;
    const words = chunk.text.split(/\s+/u).length;
    const playbackTimeoutMs = options.playbackTimeoutMs ?? Math.min(45_000, Math.max(12_000, words * 800));
    const updateCaption = createCaptionUpdater(chunk.units, () => audio, () => cancelled, options.onSegment);
    let playingStarted = false;
    // Zero-wait handoff: tells the caller the utterance is about to end (final chunk, <= handoffLeadMs left) once.
    const announceFinalChunk = () => {
      if (!isLast || !playingStarted || finalChunkAnnounced || cancelled) return;
      const duration = audio.duration;
      if (Number.isFinite(duration) && duration > 0 && duration * 1_000 - (audio.currentTime || 0) * 1_000 > handoffLeadMs) return;
      finalChunkAnnounced = true;
      options.onFinalChunkStarted?.();
    };
    const onTimeUpdate = () => { updateCaption(); announceFinalChunk(); };
    const onEnded = () => finish(resolve, "ended");
    const onError = () => finish(reject, new Error("Audio playback failed."));
    const onPlaying = () => {
      playingStarted = true;
      if (isFirst) options.onPlaybackStarted?.();
      announceFinalChunk();
    };
    const timer = schedule(() => finish(reject, Object.assign(new Error("playback timeout"), { isPlaybackTimeout: true })), playbackTimeoutMs);
    function finish(settle, value) {
      unschedule(timer);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onTimeUpdate);
      stopPlaying = null;
      settle(value);
    }
    stopPlaying = () => finish(resolve, "cancelled");
    audio.addEventListener("ended", onEnded, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.addEventListener("playing", onPlaying, { once: true });
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onTimeUpdate);
    if (chunk.sentences.length && !cancelled) options.onSegment?.(chunk.sentences[0]);
    Promise.resolve(audio.play()).catch((error) => finish(reject, error));
  });

  const run = async () => {
    if (!chunks.length) return { status: "completed" };
    requests = requestChunks(chunks, options);
    let upcoming = prepare(0);
    upcoming.catch(() => {});
    let networkPlayed = false;
    for (let index = 0; index < chunks.length; index += 1) {
      // Wait at most firstAudioTimeoutMs for this chunk; a late or failed chunk ends playback as "unavailable".
      let item;
      try {
        item = await withDeadline(upcoming, firstAudioTimeoutMs, unavailableMessages.network);
      } catch (error) {
        if (cancelled || error?.isCancelled) return { status: "cancelled" };
        throw error;
      }
      if (cancelled) return { status: "cancelled" };
      // Start buffering the following chunk while this one plays.
      upcoming = index + 1 < chunks.length ? prepare(index + 1) : null;
      upcoming?.catch(() => {});
      const outcome = await playChunk(item, chunks[index], index === 0, index === chunks.length - 1);
      networkPlayed = true;
      release(item);
      if (cancelled || outcome === "cancelled") return { status: "cancelled" };
    }
    return networkPlayed ? { status: "completed", voice: "network" } : { status: "completed" };
  };

  const promise = Promise.race([run(), cancellationResult]).catch((error) => {
    if (cancelled || error?.isCancelled) return { status: "cancelled" };
    return { status: "unavailable", message: unavailableMessageFor(error) };
  }).finally(() => {
    requests?.stop();
    stopPlaying?.();
    for (const item of prepared) release(item);
  });

  return {
    promise,
    cancel() {
      if (cancelled) return;
      cancelled = true;
      requests?.stop();
      stopPlaying?.();
      resolveCancellation({ status: "cancelled" });
      for (const item of prepared) release(item);
    },
  };
}

/**
 * Starts synthesizing an utterance before it is needed, chunk by chunk with the same chunking and request bodies as
 * `playInterviewerSegments`, so a later playback joins in-flight requests or reuses finished blobs (retained for
 * `retainMs`). `cancel()` aborts the requests unless a playback has attached to them meanwhile.
 */
export function prewarmInterviewerSpeech(segments, options) {
  const chunks = groupInterviewerSentences(segments);
  if (!chunks.length) return { promise: Promise.resolve(false), cancel() {} };
  const schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const unschedule = options.clearTimeout ?? ((id) => clearTimeout(id));
  const requests = requestChunks(chunks, { ...options, retainMs: options.retainMs ?? 30_000, onSynthesisStarted: undefined });
  const timeoutId = schedule(() => requests.stop(), options.timeoutMs ?? 20_000);
  const promise = Promise.all(requests.entries.map((entry) => entry.promise)).then(() => true, () => false).finally(() => {
    unschedule(timeoutId);
    requests.stop();
  });
  return {
    promise,
    cancel() {
      unschedule(timeoutId);
      requests.stop();
    },
  };
}

/** Best-effort wake-up of a scale-to-zero voice backend (POST <speech endpoint>/warmup); errors are ignored. */
export function warmUpInterviewerSpeech(endpoint, fetcher) {
  try {
    Promise.resolve(fetcher(`${endpoint}/warmup`, { method: "POST" })).catch(() => undefined);
  } catch {
    // Warm-up must never affect the interview.
  }
}
