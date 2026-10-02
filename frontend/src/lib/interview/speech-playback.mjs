import { isBrowserVoiceAvailable, speakWithBrowserVoice } from "./browser-voice.mjs";

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
let flightEpoch = 0;
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
  flightEpoch += 1;
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

function hasRetainedSpeechBlob(options, text) {
  return retainedSpeechBlobs.has(speechRequestFor(options, text).key);
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

// If the network audio has not arrived this fast (or the request fails), the browser voice takes over.
export const FIRST_AUDIO_FALLBACK_MS = 4_000;
export const speechUnavailableMessage = "O áudio do entrevistador não está disponível agora. O texto da pergunta continua na tela.";

// After a network voice failure/timeout the browser voice is used right away for this long, instead of waiting
// FIRST_AUDIO_FALLBACK_MS on every utterance while the provider is down.
export const NETWORK_VOICE_COOLDOWN_MS = 120_000;
let networkVoiceFailedAt = null;
const clockNow = (options) => (options?.now ?? Date.now)();

export function markNetworkVoiceFailed(now = Date.now()) { networkVoiceFailedAt = now; }
export function markNetworkVoiceHealthy() { networkVoiceFailedAt = null; }
export function shouldSkipNetworkVoice(now = Date.now()) {
  return networkVoiceFailedAt !== null && now - networkVoiceFailedAt < NETWORK_VOICE_COOLDOWN_MS;
}
/** Test hook: forgets the network voice health state. */
export function resetNetworkVoiceHealth() { networkVoiceFailedAt = null; }

// A rejected session is not a provider problem: the (Portuguese) session message is shown instead of switching voices.
const isAuthError = (error) => Boolean(error?.isUnauthenticated || (error?.isSpeechResponseError && (error.status === 401 || error.status === 403)));

function browserVoiceOptions(options, extra) {
  return { setTimeout: options.setTimeout, clearTimeout: options.clearTimeout, ...options.browserVoice, ...extra };
}

export function synthesizeInterviewerQuestion(text, options) {
  const fallbackMs = options.firstAudioFallbackMs ?? FIRST_AUDIO_FALLBACK_MS;
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
  let browserVoice = null;
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
    browserVoice?.cancel();
    resolveCancellation({ status: "cancelled" });
    cleanup();
  };

  const playbackWork = async () => {
    try {
      scheduleTimeout(fallbackMs, unavailableMessages.network, { status: "fallback" });
      options.onSynthesisStarted?.();
      flightLease = acquireSpeechBlob(options, text);
      const blob = await flightLease.promise;
      options.onSynthesisCompleted?.();
      if (cancelled) return { status: "cancelled" };
      if (timedOut) return { status: "fallback" };
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
      if (timedOut || (!audio && !isAuthError(error))) return { status: "fallback" };
      return {
        status: "unavailable",
        message: (error?.isSpeechResponseError || error?.isUnauthenticated) && error.message
          ? error.message
          : "O áudio não está disponível agora. Você pode continuar sem ele.",
      };
    } finally {
      cleanup();
    }
  };

  const speakInBrowser = async () => {
    if (cancelled) return { status: "cancelled" };
    if (!isBrowserVoiceAvailable(browserVoiceOptions(options))) return { status: "unavailable", message: speechUnavailableMessage };
    browserVoice = speakWithBrowserVoice(options.captionSegments?.filter(Boolean).length ? options.captionSegments : [text], browserVoiceOptions(options, {
      onStart: options.onPlaybackStarted,
      onSegment: (segment) => { if (!cancelled) options.onSegment?.(segment); },
    }));
    options.onBrowserVoiceStarted?.();
    const outcome = await browserVoice.promise;
    if (cancelled || outcome.status === "cancelled") return { status: "cancelled" };
    if (outcome.status === "unavailable") return { status: "unavailable", message: speechUnavailableMessage };
    return { status: "completed", voice: "browser" };
  };

  const skipNetwork = shouldSkipNetworkVoice(clockNow(options)) && isBrowserVoiceAvailable(browserVoiceOptions(options));
  const promise = (skipNetwork ? speakInBrowser() : Promise.race([playbackWork(), timeoutResult, cancellationResult])
    .finally(cleanup)
    .then((result) => {
      if (result.status === "fallback") { markNetworkVoiceFailed(clockNow(options)); return speakInBrowser(); }
      if (result.status === "completed") markNetworkVoiceHealthy();
      return result;
    }));

  return { promise, cancel };
}

// Sentences shorter than this are merged with the next one so no request is tiny; a sentence is never split
// (except the first one, see `firstChunkSplitThreshold`).
export const minimumChunkCharacters = 40;
// A group never grows past this by merging; a single sentence longer than it still stays whole.
export const maximumChunkCharacters = 140;
// The first sentence of an utterance longer than this is split at its first clause boundary so first audio arrives fast.
export const firstChunkSplitThreshold = 70;
export const firstChunkPartMinimum = 20;
// The final chunk reports it is ending once at most this much of it remains (or at its start when it is shorter).
export const finalChunkLeadMs = 3_000;
// Chunk N+1 is requested only once chunk N's audio has arrived: one network synthesis in flight per utterance.
export const maxConcurrentChunkRequests = 1;
// How long a request that missed the fallback deadline may keep running in the background to learn the outcome.
export const BACKGROUND_REQUEST_TIMEOUT_MS = 20_000;

const clauseBoundaries = [", ", "; ", " \u2014 ", ": "];

/** Splits a long first sentence at its first clause boundary leaving a first part of 20-70 characters, or returns null. */
function splitFirstSentence(sentence) {
  if (sentence.length <= firstChunkSplitThreshold) return null;
  let best = null;
  for (const boundary of clauseBoundaries) {
    let from = 0;
    for (;;) {
      const at = sentence.indexOf(boundary, from);
      if (at === -1) break;
      from = at + 1;
      const head = (boundary === " \u2014 " ? sentence.slice(0, at) : sentence.slice(0, at + boundary.trimEnd().length)).trim();
      const tail = sentence.slice(at + boundary.length).trim();
      if (head.length > firstChunkSplitThreshold) break;
      if (head.length < firstChunkPartMinimum || !tail) continue;
      if (!best || at < best.at) best = { at, head, tail };
      break;
    }
  }
  return best && { head: best.head, tail: best.tail };
}

/**
 * Groups sentences into synthesis chunks: `text` is what is sent to the voice; `sentences` are the caption sentences
 * (always whole); `units` pair each spoken piece with its caption. Each chunk is at least `minimumChunkCharacters`
 * long (except a lone short utterance, a short first part or a group that merging would push past
 * `maximumChunkCharacters`). A first sentence over 70 characters becomes its own short first chunk plus a remainder.
 */
export function groupInterviewerSentences(segments) {
  const sentences = segments.map((segment) => segment.trim()).filter(Boolean);
  const chunks = [];
  let pending = [];
  let locked = false;
  const lengthOf = (units) => units.map((unit) => unit.text).join(" ").length;
  const flush = () => { chunks.push({ units: pending, locked }); pending = []; locked = false; };

  sentences.forEach((sentence, index) => {
    let units = [{ text: sentence, caption: sentence }];
    const split = index === 0 ? splitFirstSentence(sentence) : null;
    if (split) {
      chunks.push({ units: [{ text: split.head, caption: sentence }], locked: true });
      units = [{ text: split.tail, caption: sentence }];
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
 * finishes playing). Leases dedupe against prewarmed blobs. `detach` stops further requests but lets the in-flight
 * one finish in the background, only to report whether the voice is healthy.
 */
function requestChunks(chunks, options) {
  let active = 0;
  let next = 0;
  let stopped = false;
  let detached = false;
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
      if (detached) return;
      stopped = true;
      for (const entry of entries) entry.lease?.release(false);
    },
    detach(onOutcome) {
      if (detached) return;
      detached = true;
      stopped = true;
      const epoch = flightEpoch;
      const schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
      const unschedule = options.clearTimeout ?? ((id) => clearTimeout(id));
      for (const entry of entries) {
        if (!entry.lease) continue;
        if (entry.settled) { entry.lease.release(false); continue; }
        const lease = entry.lease;
        let done = false;
        const finish = (healthy, error) => {
          if (done) return;
          done = true;
          unschedule(timerId);
          lease.release(false);
          if (epoch === flightEpoch && (healthy || !isAuthError(error))) onOutcome(healthy);
        };
        const timerId = schedule(() => finish(false), options.backgroundRequestTimeoutMs ?? BACKGROUND_REQUEST_TIMEOUT_MS);
        lease.promise.then(() => finish(true), (error) => finish(false, error));
      }
    },
  };
}

const unavailableMessages = {
  default: "O áudio não está disponível agora. Você pode continuar sem ele.",
  network: speechUnavailableMessage,
  playback: "A reprodução do áudio demorou demais. Você pode continuar sem ele.",
};

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
  const fallbackMs = options.firstAudioFallbackMs ?? FIRST_AUDIO_FALLBACK_MS;
  let cancelled = false;
  let fellBack = false;
  let playbackStartedFired = false;
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
    // Network audio that arrives after the browser voice took over is ignored.
    if (cancelled || fellBack) throw Object.assign(new Error("cancelled"), { isCancelled: true });
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
      if (isFirst) { playbackStartedFired = true; options.onPlaybackStarted?.(); }
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

  // Network speech is stalled or failed: speak the remaining sentences with the browser voice.
  const speakRemainingInBrowser = async (fromChunk, { slowIndex = null } = {}) => {
    fellBack = true;
    if (slowIndex !== null && requests) {
      // Slow but not failed: let the request finish in the background only to learn the outcome; its audio is never played.
      requests.detach((healthy) => { if (healthy) markNetworkVoiceHealthy(); else markNetworkVoiceFailed(clockNow(options)); });
    } else requests?.stop();
    if (cancelled) return { status: "cancelled" };
    if (!isBrowserVoiceAvailable(browserVoiceOptions(options))) return { status: "unavailable", message: speechUnavailableMessage };
    const units = chunks.slice(fromChunk).flatMap((chunk) => chunk.units);
    const sentences = units.map((unit) => unit.text);
    const voice = speakWithBrowserVoice(sentences, browserVoiceOptions(options, {
      onStart: () => {
        if (!playbackStartedFired) { playbackStartedFired = true; options.onPlaybackStarted?.(); }
        options.onBrowserVoiceStarted?.();
      },
      onSegment: (sentence, sentenceIndex) => {
        if (cancelled) return;
        options.onSegment?.(units[sentenceIndex]?.caption ?? sentence);
        if (sentenceIndex === sentences.length - 1 && !finalChunkAnnounced) {
          finalChunkAnnounced = true;
          options.onFinalChunkStarted?.();
        }
      },
    }));
    stopPlaying = () => voice.cancel();
    const outcome = await voice.promise;
    stopPlaying = null;
    if (cancelled || outcome.status === "cancelled") return { status: "cancelled" };
    if (outcome.status === "unavailable") return { status: "unavailable", message: speechUnavailableMessage };
    return { status: "completed", voice: "browser" };
  };

  const run = async () => {
    if (!chunks.length) return { status: "completed" };
    // Network voice is known to be down: skip the wait (unless the whole utterance was already prepared).
    const allPrepared = chunks.every((chunk) => hasRetainedSpeechBlob(options, chunk.text));
    if (!allPrepared && shouldSkipNetworkVoice(clockNow(options)) && isBrowserVoiceAvailable(browserVoiceOptions(options))) {
      return speakRemainingInBrowser(0);
    }
    requests = requestChunks(chunks, options);
    let upcoming = prepare(0);
    upcoming.catch(() => {});
    let networkPlayed = false;
    for (let index = 0; index < chunks.length; index += 1) {
      // Wait at most fallbackMs for this chunk; a late or failed chunk hands the rest over to the browser voice.
      let item;
      try {
        item = await withDeadline(upcoming, fallbackMs, unavailableMessages.network);
      } catch (error) {
        if (cancelled || error?.isCancelled) return { status: "cancelled" };
        if (isAuthError(error)) throw error;
        if (error?.isSpeechTimeout) return speakRemainingInBrowser(index, { slowIndex: index });
        markNetworkVoiceFailed(clockNow(options));
        return speakRemainingInBrowser(index);
      }
      if (cancelled) return { status: "cancelled" };
      markNetworkVoiceHealthy();
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
    return {
      status: "unavailable",
      message: error?.isSpeechTimeout ? unavailableMessages.network
        : error?.isPlaybackTimeout ? unavailableMessages.playback
        : (error?.isSpeechResponseError || error?.isUnauthenticated) && error.message ? error.message
        : unavailableMessages.default,
    };
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
  if (!chunks.length || shouldSkipNetworkVoice(clockNow(options))) return { promise: Promise.resolve(false), cancel() {} };
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
