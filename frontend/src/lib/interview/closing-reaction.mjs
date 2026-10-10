// The last answer of the interview: while the candidate is still answering, a short grounded reaction ("So you traced it to the
// cache TTL.") is prepared so the interviewer can react before closing. It is only ever used if it is ready, never waited for
// longer than a short cap, and only when it still matches what the candidate finally said.

import { stripLeadingAcknowledgement } from "./acknowledgement.mjs";
import { hasTimeForNextQuestion } from "./session-policy.mjs";

/** The answer being given will end after "now": assume this much more time passes (answer tail + handoff) before it is final. */
export const ANSWER_LOOKAHEAD_SECONDS = 10;
export const MAX_CLOSING_REACTION_CALLS = 2;
export const CLOSING_REACTION_MIN_WORDS = 8;
export const CLOSING_REACTION_MAX_WAIT_MS = 400;

/** True when the answer in progress is the last one: it was flagged as the last, or the next question would not fit by the time it ends. */
export function isLastAnswerExpected({ elapsedSeconds, durationMinutes, finishAfter = false, lookaheadSeconds = ANSWER_LOOKAHEAD_SECONDS }) {
  return finishAfter === true || !hasTimeForNextQuestion(elapsedSeconds + lookaheadSeconds, durationMinutes);
}

const wordsOf = (text) => String(text ?? "").toLocaleLowerCase().replace(/['’]/gu, "").match(/[\p{L}\p{N}]+/gu) ?? [];
const countWords = (text) => wordsOf(text).length;

/**
 * Whether a reaction written for `snapshot` still fits the final transcript: the same transcript, or every substantial word of
 * the reaction (5+ letters, matched by its first four letters to tolerate inflections) is still in the final transcript.
 */
export function isReactionCompatible(reaction, snapshot, finalTranscript) {
  if (typeof reaction !== "string" || !reaction.trim()) return false;
  const final = wordsOf(finalTranscript);
  if (final.length === 0) return false;
  if (wordsOf(snapshot).join(" ") === final.join(" ")) return true;
  const stems = new Set(final.map((word) => word.slice(0, 4)));
  const substantial = wordsOf(reaction).filter((word) => word.length >= 5);
  return substantial.length > 0 && substantial.every((word) => stems.has(word.slice(0, 4)));
}

/**
 * Neutral reactions said before the closing line when the model has none for the last answer. They claim nothing about the answer,
 * never praise, and none opens with an acknowledgement word, so "Okay." + fallback never doubles. Mirrored in the backend.
 */
export const CLOSING_FALLBACK_REACTIONS = [
  "I understand, thank you for walking me through that.",
  "That makes sense, thank you for explaining.",
  "I follow what you mean, thank you for explaining that.",
  "I understand what you mean, thank you.",
  "That makes sense, thank you for sharing that.",
];

/** A fallback reaction other than `lastUsed` (the one the previous interview used). */
export function pickClosingFallbackReaction(lastUsed = null, random = Math.random) {
  const options = CLOSING_FALLBACK_REACTIONS.filter((reaction) => reaction !== lastUsed);
  const pool = options.length ? options : CLOSING_FALLBACK_REACTIONS;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** True when the text opens with an acknowledgement word, so a separate "Okay." before it would double up. */
export function startsWithAcknowledgement(text) {
  return /^\s*(?:okay|ok|alright|all right|got it|gotcha|right|sure|understood|i see|mm-?hm+|thanks|thank you)\b/iu.test(String(text ?? ""));
}

/** The texts a ready reaction may be spoken as: itself, plus its form without a leading acknowledgement (used when "Okay." already played). */
export function closingReactionVariants(reaction) {
  const text = String(reaction ?? "").trim();
  if (!text) return [];
  const stripped = startsWithAcknowledgement(text) ? stripLeadingAcknowledgement(text) : "";
  return stripped && stripped !== text ? [text, stripped] : [text];
}

/**
 * Prepares the closing reaction from provisional snapshots of the last answer: at most `maxCalls` calls per answer (the first
 * from `minWords` words on, a second only when the snapshot has grown clearly), the older pending call aborted when a newer one
 * starts. `request(snapshot, signal, context)` resolves (`context` is whatever the caller passed to `update`) a reaction string or null and must not throw.
 */
export function createClosingReactionTracker({ request, onReaction, maxCalls = MAX_CLOSING_REACTION_CALLS, minWords = CLOSING_REACTION_MIN_WORDS, growthRatio = 1.4, minNewWords = 6 }) {
  let turnKey = null;
  let entries = [];
  const reset = () => {
    for (const entry of entries) if (entry.state === "pending") entry.controller.abort();
    entries = [];
  };
  return {
    /** Offers a provisional snapshot of the answer in `key` (with the caller's `context` for the request and `onReaction`); returns true when a call was started. */
    update(key, snapshot, context = null) {
      if (turnKey !== key) { reset(); turnKey = key; }
      if (entries.length >= maxCalls) return false;
      const words = countWords(snapshot);
      if (words < minWords) return false;
      const last = entries[entries.length - 1];
      if (last && (words < last.words * growthRatio || words - last.words < minNewWords)) return false;
      for (const entry of entries) if (entry.state === "pending") entry.controller.abort();
      const controller = new AbortController();
      const entry = { snapshot, words, context, controller, state: "pending", reaction: null, promise: null };
      entry.promise = new Promise((resolve) => { try { resolve(request(snapshot, controller.signal, context)); } catch { resolve(null); } }).catch(() => null).then((reaction) => {
        if (controller.signal.aborted) { entry.state = "aborted"; return; }
        if (typeof reaction === "string" && reaction.trim()) {
          entry.state = "ready";
          entry.reaction = reaction.trim();
          try { onReaction?.(entry.reaction, entry.snapshot, entry.context); } catch { /* Preparation only. */ }
        } else entry.state = "failed";
      });
      entries.push(entry);
      return true;
    },
    /** The newest ready reaction of the answer in `key`, if any (no waiting). Entries of another turn are never returned. */
    peek(key) {
      if (turnKey === null || turnKey !== key) return null;
      for (let index = entries.length - 1; index >= 0; index -= 1) if (entries[index].state === "ready") return { reaction: entries[index].reaction, snapshot: entries[index].snapshot };
      return null;
    },
    /**
     * The reaction for the final transcript of the answer in `key`: the newest ready one that is still compatible. A pending newest call is awaited
     * for at most `waitMs`; never longer. Resolves null when nothing usable is ready.
     */
    async resolve(key, finalTranscript, { waitMs = CLOSING_REACTION_MAX_WAIT_MS } = {}) {
      if (turnKey === null || turnKey !== key) return null;
      const newest = entries[entries.length - 1];
      if (newest?.state === "pending" && waitMs > 0) {
        let timer;
        await Promise.race([newest.promise, new Promise((resolve) => { timer = setTimeout(resolve, Math.min(waitMs, CLOSING_REACTION_MAX_WAIT_MS)); })]);
        clearTimeout(timer);
      }
      if (turnKey !== key) return null;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry.state === "ready" && isReactionCompatible(entry.reaction, entry.snapshot, finalTranscript)) return entry.reaction;
      }
      return null;
    },
    get callCount() { return entries.length; },
    /** Aborts pending calls and forgets everything. */
    cancel() { reset(); turnKey = null; },
  };
}

/**
 * What the interviewer says before the closing line, as text: the optional instant acknowledgement (audio only; text-only
 * shows a word), then the prepared reaction of THIS turn when it is ready and still matches the answer. Null when there is
 * nothing to say. `acknowledge=false` means the acknowledgement already played, so a leading "Okay." of the reaction is dropped.
 * `deps`: `tracker`, `key` (the answer's mic turn), `answer`, `acknowledge`, `canAcknowledge` (the answer is long enough),
 * `playAcknowledgement()` (starts it; true when it will be heard), `audio` (the interviewer is spoken), `pickWord()` (text-only word).
 * `fallbackReaction` (optional): the neutral reaction used when the answer counts (`canAcknowledge`) but no model reaction is usable;
 * `onSource(source)` (optional) is told "model", "fallback" or "none" (content-free).
 */
export async function composeClosingLead({ tracker, key, answer, acknowledge, canAcknowledge, playAcknowledgement, audio, pickWord, fallbackReaction = null, onSource }) {
  const ready = tracker.peek(key);
  const skipAcknowledgement = ready !== null && startsWithAcknowledgement(ready.reaction);
  let spoken = false;
  if (acknowledge && !skipAcknowledgement && canAcknowledge) spoken = playAcknowledgement() === true;
  const modelReaction = await tracker.resolve(key, answer);
  const useFallback = !modelReaction && canAcknowledge && typeof fallbackReaction === "string" && fallbackReaction.trim() !== "";
  let reaction = modelReaction || (useFallback ? fallbackReaction.trim() : null);
  if (reaction && (spoken || !acknowledge) && startsWithAcknowledgement(reaction)) reaction = stripLeadingAcknowledgement(reaction) || null;
  try { onSource?.(reaction ? (modelReaction ? "model" : "fallback") : "none"); } catch { /* Diagnostics only. */ }
  if (audio) return reaction;
  const word = acknowledge && canAcknowledge && !(reaction && startsWithAcknowledgement(reaction)) ? pickWord() : null;
  return [word, reaction].filter(Boolean).join(" ") || null;
}
