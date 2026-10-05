// Instant acknowledgement: the moment the candidate's answer is considered finished the interviewer says a short
// "Okay." / "Got it." from audio that was synthesized earlier (same voice, kept in memory), so there is no silence while
// the transcript, the next-turn decision and the real question's speech are produced in parallel.

import { acquireInterviewerAudio, releaseInterviewerAudio } from "./audio-unlock.mjs";
import { errorNameOf } from "./client-environment.mjs";
import { fetchSpeechBlob } from "./speech-playback.mjs";

export const ACKNOWLEDGEMENT_PHRASES = ["Okay.", "Got it.", "Alright.", "Mm-hm, okay.", "Thanks."];

/** A natural beat between the end of the answer and the acknowledgement, and between the acknowledgement and the question. */
export const ACKNOWLEDGEMENT_LEAD_MS = 450;
export const ACKNOWLEDGEMENT_GAP_MS = 320;
/** Shorter answers ("yes", "I don't know", noise) are not acknowledged: there is nothing to react to. */
export const ACKNOWLEDGEMENT_MIN_WORDS = 5;

/** True when the answer has enough words to deserve a spoken acknowledgement. */
export function isAcknowledgeableAnswer(transcript) {
  return (String(transcript ?? "").match(/[\p{L}\p{N}']+/gu) ?? []).length >= ACKNOWLEDGEMENT_MIN_WORDS;
}

const normalize = (text) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/gu, " ").trim();

/** Opening word(s) that identify a family of acknowledgements, so "Okay, thanks." and "OK." count as the same one. */
function acknowledgementFamily(text) {
  const words = normalize(text);
  const families = [["okay", /^(?:okay|ok)\b/u], ["got it", /^(?:got it|gotcha)\b/u], ["alright", /^(?:alright|all right)\b/u], ["mm-hm", /^(?:mm-?hm+|mhm+|uh-?huh)\b/u], ["thanks", /^(?:thanks|thank you)\b/u]];
  return families.find(([, pattern]) => pattern.test(words))?.[0] ?? null;
}

/**
 * Chooses the acknowledgement to play: the next phrase in rotation after `lastPhrase` that has audio, skipping any whose family
 * the interviewer used in a recent bridge (`recent`). Falls back to any phrase with audio other than the last one, then the last.
 */
export function pickAcknowledgement({ phrases = ACKNOWLEDGEMENT_PHRASES, available = phrases, recent = [], lastPhrase = null } = {}) {
  const usable = phrases.filter((phrase) => available.includes(phrase));
  if (usable.length === 0) return null;
  const recentFamilies = new Set(recent.map(acknowledgementFamily).filter(Boolean));
  const start = lastPhrase === null ? -1 : phrases.indexOf(lastPhrase);
  const rotation = phrases.map((_phrase, offset) => phrases[(start + 1 + offset) % phrases.length]).filter((phrase) => usable.includes(phrase));
  return rotation.find((phrase) => phrase !== lastPhrase && !recentFamilies.has(acknowledgementFamily(phrase)))
    ?? rotation.find((phrase) => phrase !== lastPhrase)
    ?? rotation[0];
}

// Pure acknowledgement tokens: removed from the front of the generated bridge only when they stand alone (followed by
// punctuation or the end), so "Thanks for sharing that." keeps its meaning and "Okay, so what ..." loses only "Okay,".
const leadingAcknowledgement = /^(?:okay|ok|alright|all right|got it|gotcha|thanks|thank you|great|perfect|good|right|sure|understood|i see|mm-?hm+|mhm+|uh-?huh|cool|nice|excellent)\s*(?:[,.!;:—…-]+\s*|$)/iu;

// Whole leading sentences that only acknowledge (no content about the answer). They must end the sentence, so
// "Thanks for explaining the retry logic, ..." and "That makes sense because ..." are kept.
const acknowledgementSentence = /^(?:thanks|thank you)(?: so much| a lot)?(?: for (?:that|this|sharing(?: that| this)?|the (?:example|details?|context|answer|explanation)|your (?:answer|example|explanation|time)))?\s*[.!]\s*|^(?:that|this) makes sense\s*[.!]\s*|^that'?s (?:helpful|great|clear|good|interesting)\s*[.!]\s*|^(?:let'?s|let us) (?:move on|continue|keep going)\s*[.!]\s*|^moving on\s*[.!]\s*/iu;

/**
 * Removes pure acknowledgement words and whole acknowledgement-only sentences from the start of a bridge
 * ("Okay, thanks. Tell me ..." -> "Tell me ..."; "Thanks for that. Let's move on. Can you ..." -> "Can you ..."); capitalizes the rest.
 */
export function stripLeadingAcknowledgement(text) {
  let rest = (text ?? "").trim();
  for (let pass = 0; pass < 6; pass += 1) {
    const stripped = rest.replace(leadingAcknowledgement, "").replace(acknowledgementSentence, "").trim();
    if (stripped === rest) break;
    rest = stripped;
  }
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : "";
}

/**
 * Holds the pre-synthesized acknowledgement blobs and plays one. Playback uses the interviewer's audio surface (pooled
 * element, or Web Audio on iOS) and feeds `onChunkAudio` like any speech chunk so the toucan's beak follows it.
 */
export function createAcknowledgementPlayer(options) {
  const phrases = options.phrases ?? ACKNOWLEDGEMENT_PHRASES;
  const makeAudio = options.makeAudio ?? acquireInterviewerAudio;
  const releaseAudio = options.makeAudio ? () => {} : releaseInterviewerAudio;
  const createObjectUrl = options.createObjectUrl ?? ((blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url) => URL.revokeObjectURL(url));
  const schedule = options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
  const unschedule = options.clearTimeout ?? ((id) => globalThis.clearTimeout(id));
  const maxPlayMs = options.maxPlayMs ?? 5_000;
  const loadBlob = options.loadBlob ?? ((phrase) => fetchSpeechBlob(phrase, { endpoint: options.endpoint, fetcher: options.fetcher, timeoutMs: 20_000 }));
  const blobs = new Map();
  let preloading = null;
  let lastPhrase = null;
  const now = options.now ?? (() => Date.now());
  const leadMs = options.leadMs ?? ACKNOWLEDGEMENT_LEAD_MS;
  const gapMs = options.gapMs ?? ACKNOWLEDGEMENT_GAP_MS;
  const sleep = (ms) => new Promise((resolve) => schedule(resolve, ms));
  let current = null;
  let idle = Promise.resolve();
  // The pending (scheduled, not yet started) acknowledgement of the current turn, and what the turn already did.
  let pending = null;
  let questionStarted = false;
  let lastEndedAt = null;

  const diagnose = (kind, extra = {}) => {
    try { options.onDiagnostic?.({ kind, ...extra }); } catch { /* Diagnostics only. */ }
  };

  return {
    /** Synthesizes every phrase once, one request at a time (so it never competes with the real speech). Idempotent. */
    preload() {
      preloading ??= (async () => {
        for (const phrase of phrases) {
          try { blobs.set(phrase, await loadBlob(phrase)); } catch { /* A missing phrase is simply never picked. */ }
        }
        diagnose("ack_preloaded", { loaded: blobs.size, total: phrases.length });
      })();
      return preloading;
    },
    get loadedCount() { return blobs.size; },
    get lastPhrase() { return lastPhrase; },
    /** Resolves when the acknowledgement that is playing (if any) has ended. */
    whenIdle() { return idle; },
    get playing() { return current !== null; },
    /** Starts an acknowledgement now. Returns null (nothing played) when no audio is loaded or one is already playing. */
    play({ recent = [], answerFinalAt = null } = {}) {
      if (current) return null;
      if (questionStarted) { diagnose("ack_skipped", { reason: "question_started" }); return null; }
      const phrase = pickAcknowledgement({ phrases, available: [...blobs.keys()], recent, lastPhrase });
      if (!phrase) return null;
      lastPhrase = phrase;
      const blob = blobs.get(phrase);
      let url = null;
      let audio = null;
      let timer = null;
      let playing = false;
      let finish;
      const done = new Promise((resolve) => { finish = resolve; });
      const cleanup = () => {
        if (timer !== null) unschedule(timer);
        timer = null;
        playing = false;
        if (audio) {
          audio.pause();
          audio.removeAttribute?.("src");
          audio.load?.();
          releaseAudio(audio);
        }
        audio = null;
        if (url) revokeObjectUrl(url);
        url = null;
        if (current === handle) current = null;
        finish();
      };
      const handle = { phrase, promise: done, cancel: cleanup };
      const startedAt = now();
      const finishDiagnostics = () => { lastEndedAt = now(); diagnose("ack_ended", { ackDurationMs: Math.max(0, lastEndedAt - startedAt) }); };
      done.then(finishDiagnostics);
      current = handle;
      idle = done;
      try {
        url = createObjectUrl(blob);
        audio = makeAudio(url);
        const track = audio;
        track.addEventListener("ended", cleanup, { once: true });
        track.addEventListener("error", cleanup, { once: true });
        try {
          options.onChunkAudio?.({
            chunkIndex: 0,
            chunkCount: 1,
            endsWithQuestion: false,
            blob,
            ...(typeof track.whenDecoded === "function" ? { decodeAudio: () => track.whenDecoded() } : {}),
            clock: () => (audio === track && playing ? Number(track.currentTime) || 0 : 0),
            isPlaying: () => Boolean(audio === track && playing && !track.paused && !track.ended),
          });
        } catch { /* The lip-sync feed must never affect playback. */ }
        timer = schedule(cleanup, maxPlayMs);
        playing = true;
        diagnose("ack_play", answerFinalAt === null ? {} : { answerToAckMs: Math.max(0, startedAt - answerFinalAt) });
        Promise.resolve(track.play()).then(
          () => diagnose("ack_play_resolved"),
          (error) => { diagnose("ack_play_failed", { errorName: errorNameOf(error) }); cleanup(); },
        );
      } catch (error) {
        diagnose("ack_play_failed", { errorName: errorNameOf(error) });
        cleanup();
        return null;
      }
      return handle;
    },
    /**
     * Schedules the acknowledgement of a final answer after a short natural beat. Returns null when nothing will be said
     * (no audio loaded, `shouldPlay` false, one already scheduled); otherwise a handle whose `promise` settles when the
     * acknowledgement ended or was dropped. `whenIdle()` covers the beat, so the question never overtakes it.
     */
    schedule({ recent = [], shouldPlay = () => true } = {}) {
      if (current || pending) return null;
      if (blobs.size === 0) { diagnose("ack_skipped", { reason: "not_loaded" }); return null; }
      questionStarted = false;
      lastEndedAt = null;
      const answerFinalAt = now();
      let settle;
      const settled = new Promise((resolve) => { settle = resolve; });
      const entry = { promise: settled, cancel: () => { if (entry.timer !== null) unschedule(entry.timer); entry.timer = null; if (pending === entry) pending = null; settle(); } , timer: null };
      pending = entry;
      idle = settled;
      entry.timer = schedule(() => {
        entry.timer = null;
        if (pending === entry) pending = null;
        if (!shouldPlay()) { diagnose("ack_skipped", { reason: "not_applicable" }); settle(); return; }
        const handle = this.play({ recent, answerFinalAt });
        if (!handle) { settle(); return; }
        handle.promise.then(settle);
      }, leadMs);
      return entry;
    },
    /** True while an acknowledgement is scheduled or audible. */
    get busy() { return pending !== null || current !== null; },
    /**
     * Gate for the first chunk of the next question: waits for the acknowledgement (beat included), then leaves a short gap,
     * and marks the question as started so a late acknowledgement is skipped instead of talking over it.
     */
    async beforeQuestion() {
      await idle;
      const spoke = lastEndedAt !== null;
      if (spoke && gapMs > 0) await sleep(gapMs);
      questionStarted = true;
      if (spoke) diagnose("ack_question_gap", { ackToQuestionMs: lastEndedAt === null ? 0 : Math.max(0, now() - lastEndedAt) });
      if (current) diagnose("ack_overlap");
    },
    /** Stops a playing or scheduled acknowledgement (leaving the room, the interview closing). */
    cancel() { pending?.cancel(); current?.cancel(); },
  };
}
