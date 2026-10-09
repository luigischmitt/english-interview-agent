// The last answer of the interview: while the candidate is still answering, a short grounded reaction ("So you traced it to the
// cache TTL.") is prepared so the interviewer can react before closing. It is only ever used if it is ready, never waited for
// longer than a short cap, and only when it still matches what the candidate finally said.

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

/** True when the text opens with an acknowledgement word, so a separate "Okay." before it would double up. */
export function startsWithAcknowledgement(text) {
  return /^\s*(?:okay|ok|alright|all right|got it|gotcha|right|sure|understood|i see|mm-?hm+|thanks|thank you)\b/iu.test(String(text ?? ""));
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
    /** The newest ready reaction, if any (no waiting). */
    peek() {
      for (let index = entries.length - 1; index >= 0; index -= 1) if (entries[index].state === "ready") return { reaction: entries[index].reaction, snapshot: entries[index].snapshot };
      return null;
    },
    /**
     * The reaction for the final transcript: the newest ready one that is still compatible. A pending newest call is awaited
     * for at most `waitMs`; never longer. Resolves null when nothing usable is ready.
     */
    async resolve(finalTranscript, { waitMs = CLOSING_REACTION_MAX_WAIT_MS } = {}) {
      const newest = entries[entries.length - 1];
      if (newest?.state === "pending" && waitMs > 0) {
        let timer;
        await Promise.race([newest.promise, new Promise((resolve) => { timer = setTimeout(resolve, Math.min(waitMs, CLOSING_REACTION_MAX_WAIT_MS)); })]);
        clearTimeout(timer);
      }
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
