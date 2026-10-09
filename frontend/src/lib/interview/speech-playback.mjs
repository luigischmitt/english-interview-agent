import { acquireInterviewerAudio, isAutoplayBlockedError, releaseInterviewerAudio } from "./audio-unlock.mjs";
import { describeMedia, errorNameOf } from "./client-environment.mjs";
import { describeRoleForSpeech, focusClause } from "./opening-copy.mjs";
import { isResumePractice } from "./resume-neutral.mjs";

export function composeOpeningUtterance(introduction, firstQuestion) {
  return [introduction.trim(), firstQuestion.trim()].filter(Boolean).join(" ");
}

export function composeContextualOpening(config, firstQuestion) {
  const seniorityLabels = { junior: "junior", "mid-level": "mid-level", senior: "senior", staff: "staff-level" };
  const minutes = Number.parseInt(config.duration, 10) || 5;
  // Resume practice has no target job: no role, seniority or focus is spoken.
  if (isResumePractice(config)) return `Hi, I'm Tuk, and I'll be your interviewer today. We have about ${minutes} minutes for a practice interview based on your resume. ${firstQuestion.trim()}`;
  const { phrase, personal } = describeRoleForSpeech(config.role, seniorityLabels[config.seniority?.trim()]);
  // Keep the brand stylized as TUC in the UI, but use title case in speech so Kokoro says it as a name ("Tuk"), not as initials.
  return `Hi, I'm Tuk, and I'll be your interviewer today. We have about ${minutes} minutes ${personal ? "for your " : "for "}${phrase}${focusClause(config.focus)}. ${firstQuestion.trim()}`;
}

export function composeAcknowledgedQuestion(acknowledgement, question) {
  return [acknowledgement?.trim(), question.trim()].filter(Boolean).join(" ");
}

/** Closing lines (the time is up, feedback is next), rotated so two interviews in a row do not end the same way. Mirrored in the backend. */
export const INTERVIEW_CLOSINGS = [
  "That’s all the time we have today. Thanks for your answers. I’ll prepare your feedback now.",
  "We’re out of time, so let’s stop here. Thank you for talking with me. I’ll prepare your feedback now.",
  "Our time is up for today. Thanks for your time and your answers. I’ll get your feedback ready now.",
  "That’s the end of our time today. I appreciate your answers. Your feedback will be ready in a moment.",
  "We’ve reached the end of our time. Thanks for the conversation. I’ll prepare your feedback now.",
];

/** Closing lines when the interview ends before the time is up (the candidate finished, or no planned questions are left). Mirrored in the backend. */
export const INTERVIEW_ENDED_CLOSINGS = [
  "That brings us to the end of the interview. Thanks for your answers. I’ll prepare your feedback now.",
  "That’s everything I wanted to ask today. Thank you for talking with me. I’ll get your feedback ready now.",
  "Let’s wrap up here. I appreciate your answers. Your feedback will be ready in a moment.",
  "That’s the end of the interview. Thanks for the conversation. I’ll prepare your feedback now.",
];

/** Why the interview closes: "time_up" (the time ran out) or "ended" (finished early, or no more questions). */
export function closingLinesFor(reason = "time_up") {
  return reason === "ended" ? INTERVIEW_ENDED_CLOSINGS : INTERVIEW_CLOSINGS;
}

/** A closing line of the set for `reason` other than `lastUsed` (the one the previous interview ended with in that set). */
export function pickInterviewClosing(lastUsed = null, random = Math.random, reason = "time_up") {
  const lines = closingLinesFor(reason);
  const options = lines.filter((closing) => closing !== lastUsed);
  const pool = options.length ? options : lines;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** What the interviewer says to close: an optional reaction to the last answer, then the closing line. */
export function composeInterviewClosing(reaction = null, closing = INTERVIEW_CLOSINGS[0]) {
  return [reaction?.trim(), closing.trim()].filter(Boolean).join(" ");
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

// Live prewarms per request key: identical utterances share one retained blob, so it is only forgotten when the
// last prewarm holding it is cancelled.
const retainedSpeechHolders = new Map();

function holdRetainedSpeechBlob(key) {
  retainedSpeechHolders.set(key, (retainedSpeechHolders.get(key) ?? 0) + 1);
}

function releaseRetainedSpeechBlob(key) {
  const holders = (retainedSpeechHolders.get(key) ?? 1) - 1;
  if (holders > 0) {
    retainedSpeechHolders.set(key, holders);
    return;
  }
  retainedSpeechHolders.delete(key);
  forgetRetainedSpeechBlob(key);
}

function forgetRetainedSpeechBlob(key) {
  const entry = retainedSpeechBlobs.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  retainedSpeechBlobs.delete(key);
}

/** Test hook: forgets retained blobs and their timers. */
export function clearRetainedSpeechBlobs() {
  for (const entry of retainedSpeechBlobs.values()) clearTimeout(entry.timer);
  retainedSpeechBlobs.clear();
  retainedSpeechHolders.clear();
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
    body: JSON.stringify(options.requestBody ?? { text, ...(typeof options.voice === "string" && options.voice ? { voice: options.voice } : {}), ...(typeof options.speed === "number" && options.speed !== 1 ? { speed: options.speed } : {}) }),
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

/** Fetches the synthesized audio of one short text (shared in-flight request, deduped like the chunk requests). */
export function fetchSpeechBlob(text, options) {
  const lease = acquireSpeechBlob(options, text);
  return lease.promise.finally(() => lease.release(false));
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
// The browser (iOS) refused to start audio without a tap: a tap on "Ouvir" unlocks it and replays the utterance.
export const autoplayBlockedMessage = "Toque para ouvir o entrevistador. Seu navegador bloqueou o áudio automático.";
export const AUTOPLAY_BLOCKED_REASON = "autoplay_blocked";

// A rejected session is not a provider problem: the (Portuguese) session message is shown instead of the generic one.
const isAuthError = (error) => Boolean(error?.isUnauthenticated || (error?.isSpeechResponseError && (error.status === 401 || error.status === 403)));

const unavailableMessages = {
  default: speechUnavailableMessage,
  network: speechUnavailableMessage,
  playback: speechUnavailableMessage,
};

// A session problem keeps its own (Portuguese) message; every other failure shows the generic one.
const unavailableMessageFor = (error) => (isAuthError(error) && error.message ? error.message : unavailableMessages.default);

// A play() refused for lack of a user gesture is reported with its own reason and message (no content, no URL).
const unavailableResultFor = (error) => (isAutoplayBlockedError(error)
  ? { status: "unavailable", message: autoplayBlockedMessage, reason: AUTOPLAY_BLOCKED_REASON }
  : { status: "unavailable", message: unavailableMessageFor(error) });

/**
 * Content-free per-chunk diagnostics for `options.onDiagnostic` (never throws): kind, chunk position, time since the
 * play() call, the media element's muted/volume/currentTime and whether it is a pooled element or a Web Audio track.
 */
function createChunkDiagnostics(options, chunkIndex, chunkCount, getAudio) {
  let startedAt = null;
  return (kind, extra = {}) => {
    if (typeof options.onDiagnostic !== "function") return;
    try {
      const audio = getAudio();
      const output = typeof audio?.dispose === "function" ? "webaudio" : "element";
      if (kind === "playback_start") startedAt = Date.now();
      options.onDiagnostic({
        kind,
        chunkIndex,
        chunkCount,
        ...(startedAt === null ? {} : { elapsedMs: Date.now() - startedAt }),
        output,
        pooled: output === "element" && !options.makeAudio,
        ...describeMedia(audio),
        ...extra,
      });
    } catch { /* Diagnostics must never affect playback. */ }
  };
}

export function synthesizeInterviewerQuestion(text, options) {
  const firstAudioTimeoutMs = options.firstAudioTimeoutMs ?? FIRST_AUDIO_TIMEOUT_MS;
  const playbackTimeoutMs = options.playbackTimeoutMs
    ?? Math.min(45_000, Math.max(12_000, text.trim().split(/\s+/).length * 800));
  // Default: a shared element that a user gesture already unlocked (see audio-unlock.mjs).
  const makeAudio = options.makeAudio ?? acquireInterviewerAudio;
  const releaseAudio = options.makeAudio ? () => {} : releaseInterviewerAudio;
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
  const diagnose = createChunkDiagnostics(options, 0, 1, () => audio);

  const timeoutResult = new Promise((resolve) => { resolveTimeout = resolve; });
  const cancellationResult = new Promise((resolve) => { resolveCancellation = resolve; });

  const scheduleTimeout = (delay, message, result = { status: "unavailable", message }) => {
    if (timeoutId !== null) unschedule(timeoutId);
    timeoutId = schedule(() => {
      timedOut = true;
      diagnose("playback_timeout");
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
      releaseAudio(audio);
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
        const onEnded = () => { diagnose("playback_ended"); resolve("ended"); };
        const onError = () => { diagnose("playback_error", { errorName: "MediaError" }); reject(new Error("Audio playback failed.")); };
        const onPlaying = () => { diagnose("playback_playing"); options.onPlaybackStarted?.(); };
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
      diagnose("playback_start");
      const outcome = await Promise.race([
        Promise.resolve(audio.play()).then(() => { diagnose("playback_play_resolved"); return playbackEnded; }),
        playbackEnded,
        timeoutResult,
        cancellationResult,
      ]);
      if (cancelled || outcome.status === "cancelled") return { status: "cancelled" };
      if (outcome.status === "unavailable") return outcome;
      return { status: "completed" };
    } catch (error) {
      if (cancelled) return { status: "cancelled" };
      diagnose("playback_error", { errorName: errorNameOf(error) });
      return unavailableResultFor(error);
    } finally {
      cleanup();
    }
  };

  const promise = Promise.race([playbackWork(), timeoutResult, cancellationResult]).finally(cleanup);

  return { promise, cancel };
}

// A whole utterance of at most this many characters stays one request.
export const firstChunkSplitThreshold = 50;
// The first chunk is the first sentence when it is at most this long; a longer one is cut at its first clause break.
export const firstChunkSentenceMaximum = 70;
// A first chunk cut at a clause break is at least this long (and a first sentence shorter than this absorbs the next one).
export const firstChunkPartMinimum = 25;
// No chunk is shorter than this, except a whole utterance that short.
export const minimumChunkCharacters = 25;
// A pending group shorter than this keeps merging with the next sentence (while the result stays within the maximum).
export const mergeBelowCharacters = 40;
// Chunks after the first are whole sentences (merged up to this length); only a single sentence longer than this is split,
// at a clause break.
export const maximumChunkCharacters = 180;
// A first chunk made of several sentences or of a trailing short sentence is never longer than this.
const firstChunkGrowthMaximum = 100;
export const laterChunkPartMinimum = 25;
// The final chunk reports it is ending once at most this much of it remains (or at its start when it is shorter).
export const finalChunkLeadMs = 3_000;
// All chunks of an utterance are requested up front, at most this many in flight at once (Kokoro runs on 4 vCPU).
export const maxConcurrentChunkRequests = 3;

const clauseBoundaries = [", ", "; ", " — ", ": "];
const conjunctionBoundaries = [" because ", " so ", " and ", " but ", " which ", " when ", " while ", " where ", " that ", " to "];

/** Splits `sentence` at the earliest clause break leaving a head of at least `minimum` characters (and a non-empty tail). */
function splitAtFirstClause(sentence, minimum) {
  let best = null;
  for (const boundary of clauseBoundaries) {
    for (let at = sentence.indexOf(boundary); at !== -1; at = sentence.indexOf(boundary, at + 1)) {
      const head = (boundary === " — " ? sentence.slice(0, at) : sentence.slice(0, at + boundary.trimEnd().length)).trim();
      const tail = sentence.slice(at + boundary.length).trim();
      if (head.length < minimum || !tail) continue;
      if (!best || head.length < best.head.length) best = { head, tail };
      break;
    }
  }
  return best;
}

/** Splits a sentence over `cap` characters at its latest clause break (else conjunction, else space) leaving a head within `cap`. */
function splitLongSentence(sentence, cap) {
  const minimum = laterChunkPartMinimum;
  const candidates = [];
  for (const boundary of clauseBoundaries) {
    for (let at = sentence.indexOf(boundary); at !== -1; at = sentence.indexOf(boundary, at + 1)) {
      const cut = boundary === " — " ? at : at + boundary.trimEnd().length;
      candidates.push({ head: sentence.slice(0, cut).trim(), tail: sentence.slice(at + boundary.length).trim() });
    }
  }
  const usable = (list) => list.filter(({ head, tail }) => head.length >= minimum && head.length <= cap && tail.length >= minimum);
  const pickLatest = (list) => list.reduce((best, entry) => (!best || entry.head.length > best.head.length ? entry : best), null);
  const clause = pickLatest(usable(candidates));
  if (clause) return clause;
  const lower = sentence.toLowerCase();
  const conjunctions = [];
  for (const word of conjunctionBoundaries) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) {
      conjunctions.push({ head: sentence.slice(0, at).trim(), tail: sentence.slice(at + 1).trim() });
    }
  }
  const conjunction = pickLatest(usable(conjunctions));
  if (conjunction) return conjunction;
  const at = sentence.lastIndexOf(" ", cap);
  if (at >= minimum && sentence.slice(at + 1).trim().length >= 1) return { head: sentence.slice(0, at).trim(), tail: sentence.slice(at + 1).trim() };
  return null;
}

function splitToFit(sentence, cap) {
  if (sentence.length <= cap) return [sentence];
  const split = splitLongSentence(sentence, cap);
  return split ? [split.head, ...splitToFit(split.tail, cap)] : [sentence];
}

/**
 * Groups sentences into synthesis chunks: `text` is what is sent to the voice; `sentences` are the caption sentences
 * (always whole); `units` pair each spoken piece with its caption.
 * - A whole utterance of at most `firstChunkSplitThreshold` characters is one chunk.
 * - The first chunk is short so speech starts fast: the first sentence when it is at most `firstChunkSentenceMaximum`
 *   characters, else its head up to the first clause break (at least `firstChunkPartMinimum`), else the whole sentence.
 * - After the first chunk, chunks end only at sentence ends: short sentences merge with the next one, up to
 *   `maximumChunkCharacters`; only a single longer sentence is split, at a clause break.
 * - No chunk is shorter than `minimumChunkCharacters` unless the whole utterance is.
 */
export function groupInterviewerSentences(segments) {
  const sentences = segments.map((segment) => segment.trim()).filter(Boolean);
  if (!sentences.length) return [];
  const lengthOf = (units) => units.map((unit) => unit.text).join(" ").length;
  const unitOf = (text, caption) => ({ text, caption });
  const chunks = [];
  let remainder = sentences.map((sentence) => unitOf(sentence, sentence));

  if (sentences.join(" ").length > firstChunkSplitThreshold) {
    const [firstSentence, ...others] = sentences;
    const caption = firstSentence;
    let first;
    remainder = others.map((sentence) => unitOf(sentence, sentence));
    if (firstSentence.length <= firstChunkSentenceMaximum) {
      first = [unitOf(firstSentence, caption)];
      // A very short opening sentence ("Thanks.") absorbs the next sentence(s) so the first chunk is not tiny.
      while (lengthOf(first) < minimumChunkCharacters && remainder.length && lengthOf([...first, remainder[0]]) <= firstChunkGrowthMaximum) first.push(remainder.shift());
    } else {
      const split = splitAtFirstClause(firstSentence, firstChunkPartMinimum);
      if (split) {
        first = [unitOf(split.head, caption)];
        remainder = [...splitToFit(split.tail, maximumChunkCharacters).map((text) => unitOf(text, caption)), ...remainder];
      } else {
        first = [unitOf(firstSentence, caption)];
      }
    }
    chunks.push({ units: first, first: true });
  }
  const later = remainder.flatMap((unit) => splitToFit(unit.text, maximumChunkCharacters).map((text) => unitOf(text, unit.caption)));

  let pending = [];
  const flush = () => { if (pending.length) chunks.push({ units: pending, first: false }); pending = []; };
  for (const unit of later) {
    if (pending.length && (lengthOf(pending) >= mergeBelowCharacters || lengthOf([...pending, unit]) > maximumChunkCharacters)) flush();
    pending.push(unit);
  }
  if (pending.length) {
    const previous = chunks[chunks.length - 1];
    const joined = previous ? lengthOf([...previous.units, ...pending]) : 0;
    if (previous && lengthOf(pending) < minimumChunkCharacters && joined <= (previous.first ? firstChunkGrowthMaximum : maximumChunkCharacters)) previous.units.push(...pending);
    else flush();
  }
  return chunks.map(({ units }) => ({
    text: units.map((unit) => unit.text).join(" "),
    sentences: units.map((unit) => unit.caption).filter((caption, index, all) => index === 0 || caption !== all[index - 1]),
    units,
  }));
}

/**
 * Requests chunk 0 alone first; once it has settled the rest start in order, at most `maxConcurrentChunkRequests` in
 * flight, a finished request letting the next pending chunk start. Leases dedupe against prewarmed blobs.
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
    // Chunk 0 is synthesized alone so it never shares Kokoro's CPU; the rest start together once it has arrived.
    while (!stopped && active < maxConcurrentChunkRequests && next < entries.length && (next === 0 || entries[0].settled)) {
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
 * Plays an utterance chunk by chunk (see `groupInterviewerSentences`). Chunk 1 is requested alone first; once it has
 * arrived the remaining chunks are requested together (at most `maxConcurrentChunkRequests` at once), chunk 1 starts as soon as it arrives and the next chunk is decoded ahead
 * (preloaded Audio) so it starts the moment the current one ends. Playback order never depends on arrival order. A failed
 * chunk ends playback as "unavailable" and the caller keeps the text visible; cancelling aborts pending requests.
 */
export function playInterviewerSegments(segments, options) {
  const chunks = groupInterviewerSentences(segments);
  const makeAudio = options.makeAudio ?? acquireInterviewerAudio;
  const releaseAudio = options.makeAudio ? () => {} : releaseInterviewerAudio;
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
    const item = { url: createObjectUrl(blob), audio: null, playing: false };
    prepared.push(item);
    item.audio = makeAudio(item.url);
    try { item.audio.preload = "auto"; } catch { /* Best effort. */ }
    announceChunkAudio(item, blob, index);
    return item;
  };

  // Hands the avatar what it needs to lip-sync this chunk: the blob (or, on the Web Audio path, the track's own
  // decode), the chunk's playback position and whether it is the one playing. Observers can never affect playback.
  const announceChunkAudio = (item, blob, index) => {
    if (typeof options.onChunkAudio !== "function") return;
    try {
      const audio = item.audio;
      options.onChunkAudio({
        chunkIndex: index,
        chunkCount: chunks.length,
        endsWithQuestion: /\?["'”’)]*\s*$/u.test(chunks[index].text),
        blob,
        ...(typeof audio.whenDecoded === "function" ? { decodeAudio: () => audio.whenDecoded() } : {}),
        clock: () => (item.audio && item.playing ? Number(item.audio.currentTime) || 0 : 0),
        isPlaying: () => Boolean(item.audio && item.playing && !item.audio.paused && !item.audio.ended),
      });
    } catch { /* The lip-sync feed must never affect playback. */ }
  };

  const release = (item) => {
    const audio = item.audio;
    item.playing = false;
    if (audio) {
      audio.pause();
      audio.removeAttribute?.("src");
      if (typeof audio.load === "function") audio.load();
      releaseAudio(audio);
    }
    item.audio = null;
    if (item.url) revokeObjectUrl(item.url);
    item.url = null;
  };

  const handoffLeadMs = options.finalChunkLeadMs ?? finalChunkLeadMs;
  let finalChunkAnnounced = false;
  let previousChunkEndedAt = null;
  const playChunk = (item, chunk, isFirst, isLast, chunkIndex) => new Promise((resolve, reject) => {
    const audio = item.audio;
    const words = chunk.text.split(/\s+/u).length;
    const playbackTimeoutMs = options.playbackTimeoutMs ?? Math.min(45_000, Math.max(12_000, words * 800));
    let questionStartAnnounced = false;
    let playingStarted = false;
    let activeCaption = "";
    const announceQuestionStart = () => {
      if (!questionStartAnnounced && playingStarted && /\?["'”’)]*\s*$/u.test(activeCaption)) {
        questionStartAnnounced = true;
        options.onQuestionStarted?.();
      }
    };
    const onSegment = (segment) => {
      options.onSegment?.(segment);
      activeCaption = segment;
      announceQuestionStart();
    };
    const updateCaption = createCaptionUpdater(chunk.units, () => audio, () => cancelled, onSegment);
    const diagnose = createChunkDiagnostics(options, chunkIndex, chunks.length, () => audio);
    // Zero-wait handoff: tells the caller the utterance is about to end (final chunk, <= handoffLeadMs left) once.
    const announceFinalChunk = () => {
      if (!isLast || !playingStarted || finalChunkAnnounced || cancelled) return;
      const duration = audio.duration;
      if (Number.isFinite(duration) && duration > 0 && duration * 1_000 - (audio.currentTime || 0) * 1_000 > handoffLeadMs) return;
      finalChunkAnnounced = true;
      options.onFinalChunkStarted?.();
    };
    const onTimeUpdate = () => { updateCaption(); announceFinalChunk(); };
    const onEnded = () => { diagnose("playback_ended"); previousChunkEndedAt = globalThis.performance?.now?.() ?? Date.now(); finish(resolve, "ended"); };
    const onError = () => { diagnose("playback_error", { errorName: "MediaError" }); finish(reject, new Error("Audio playback failed.")); };
    const onPlaying = () => {
      diagnose("playback_playing");
      playingStarted = true;
      if (isFirst) options.onPlaybackStarted?.();
      else if (previousChunkEndedAt !== null) options.onInterChunkGap?.(Math.max(0, Math.round((globalThis.performance?.now?.() ?? Date.now()) - previousChunkEndedAt)));
      announceQuestionStart();
      if (isLast) options.onFinalChunkPlaybackStarted?.();
      announceFinalChunk();
    };
    const timer = schedule(() => { diagnose("playback_timeout"); finish(reject, Object.assign(new Error("playback timeout"), { isPlaybackTimeout: true })); }, playbackTimeoutMs);
    function finish(settle, value) {
      unschedule(timer);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onTimeUpdate);
      stopPlaying = null;
      item.playing = false;
      settle(value);
    }
    stopPlaying = () => finish(resolve, "cancelled");
    audio.addEventListener("ended", onEnded, { once: true });
    audio.addEventListener("error", onError, { once: true });
    audio.addEventListener("playing", onPlaying, { once: true });
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onTimeUpdate);
    if (chunk.sentences.length && !cancelled) onSegment(chunk.sentences[0]);
    diagnose("playback_start");
    item.playing = true;
    Promise.resolve(audio.play()).then(
      () => diagnose("playback_play_resolved"),
      (error) => { diagnose("playback_error", { errorName: errorNameOf(error) }); finish(reject, error); },
    );
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
      // The first chunk waits for an acknowledgement that is still playing (its audio is already here; the rest keeps loading).
      if (index === 0 && typeof options.beforePlayback === "function") {
        try { await Promise.race([options.beforePlayback(), cancellationResult]); } catch { /* Best effort. */ }
        if (cancelled) return { status: "cancelled" };
      }
      const outcome = await playChunk(item, chunks[index], index === 0, index === chunks.length - 1, index);
      networkPlayed = true;
      release(item);
      if (cancelled || outcome === "cancelled") return { status: "cancelled" };
    }
    return networkPlayed ? { status: "completed", voice: "network" } : { status: "completed" };
  };

  const promise = Promise.race([run(), cancellationResult]).catch((error) => {
    if (cancelled || error?.isCancelled) return { status: "cancelled" };
    return unavailableResultFor(error);
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
 * Starts synthesizing an utterance before it is needed, with the same chunking and request bodies as
 * `playInterviewerSegments`, so a later playback joins in-flight requests or reuses finished blobs (retained for
 * `retainMs`). `cancel()` aborts the requests unless a playback has attached to them meanwhile.
 */
export function prewarmInterviewerSpeech(segments, options) {
  const chunks = groupInterviewerSentences(segments);
  if (!chunks.length) return { promise: Promise.resolve(false), firstChunkReady: Promise.resolve(false), cancel() {} };
  const schedule = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
  const unschedule = options.clearTimeout ?? ((id) => clearTimeout(id));
  const requests = requestChunks(chunks, { ...options, retainMs: options.retainMs ?? 30_000, onSynthesisStarted: undefined });
  const heldKeys = [...new Set(chunks.map((chunk) => speechRequestFor(options, chunk.text).key))];
  for (const key of heldKeys) holdRetainedSpeechBlob(key);
  let released = false;
  const timeoutId = schedule(() => requests.stop(), options.timeoutMs ?? 20_000);
  // Playback can start as soon as chunk 1 exists; later chunks are already in flight and are consumed in order.
  // Requiring the whole utterance here unnecessarily discards playable follow-ups with no latency benefit.
  const firstChunkReady = requests.entries[0].promise.then(() => true, () => false);
  const promise = Promise.all(requests.entries.map((entry) => entry.promise)).then(() => true, () => false).finally(() => {
    unschedule(timeoutId);
    requests.stop();
  });
  return {
    promise,
    firstChunkReady,
    cancel() {
      unschedule(timeoutId);
      requests.stop();
      // A discarded preparation must not keep its (possibly minutes-long) retained audio in memory, unless another
      // live prewarm of the same utterance still relies on it.
      if (released) return;
      released = true;
      for (const key of heldKeys) releaseRetainedSpeechBlob(key);
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
