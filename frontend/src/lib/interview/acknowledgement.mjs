// Instant acknowledgement: the moment the candidate's answer is considered finished the interviewer says a short
// "Okay." / "Got it." from audio that was synthesized earlier (same voice, kept in memory), so there is no silence while
// the transcript, the next-turn decision and the real question's speech are produced in parallel.

import { acquireInterviewerAudio, releaseInterviewerAudio } from "./audio-unlock.mjs";
import { errorNameOf } from "./client-environment.mjs";
import { fetchSpeechBlob } from "./speech-playback.mjs";

export const ACKNOWLEDGEMENT_PHRASES = ["Okay.", "Got it.", "Alright.", "Mm-hm, okay.", "Thanks."];

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

/** Removes pure acknowledgement words from the start of a bridge ("Okay, thanks. Tell me ..." -> "Tell me ..."); capitalizes the rest. */
export function stripLeadingAcknowledgement(text) {
  let rest = (text ?? "").trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const stripped = rest.replace(leadingAcknowledgement, "").trim();
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
  let current = null;
  let idle = Promise.resolve();

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
    play({ recent = [] } = {}) {
      if (current) return null;
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
        diagnose("ack_play");
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
    /** Stops a playing acknowledgement (leaving the room, the interview closing). */
    cancel() { current?.cancel(); },
  };
}
