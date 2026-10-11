// Grounded bridges ("You mentioned X. Let's switch to Y.") come from the speculative analysis that already runs while the
// candidate answers, so the handoff never waits for them. A bridge is spoken only before the planned question it was
// validated for, only in the turn and speech epoch it was prepared in, and only when its audio is already synthesized;
// anything else falls back to the neutral transition. Bridges, questions and transcripts are never logged.

/** Analyses of an answer to a follow-up only refresh coverage and the bridge: a few revisions are enough. */
export const MAX_POST_FOLLOW_UP_ANALYSES = 4;

/** The analysis bridge when it was validated for the planned question the room selected (compared as sent), else null. */
export function bridgeForSelection({ bridge, bridgeFor, originalPrompt }) {
  if (typeof bridge !== "string" || !bridge.trim() || typeof bridgeFor !== "string" || typeof originalPrompt !== "string") return null;
  return bridgeFor.trim() === originalPrompt.trim() ? bridge.trim() : null;
}

/**
 * Keeps the audio of the newest grounded bridge of the current answer alive independently of its preparation (which a
 * later claim may discard). Only one bridge is held at a time: an older or replaced one is cancelled at once.
 */
export function createPreparedBridgeRegistry() {
  let current = null;
  const cancel = (entry) => {
    if (!entry || entry.cancelled) return;
    entry.cancelled = true;
    try { entry.cancel?.(); } catch { /* Best effort. */ }
  };
  return {
    /**
     * Offers a bridge prepared for `prompt` (the exact question text that will follow it). `prewarm(utterance)` starts the
     * synthesis and returns `{ firstChunkReady, cancel }`; it is called only when the offer is kept. Returns whether it was kept.
     */
    offer({ turnId, revision, speechEpoch, bridge, prompt, utterance, prewarm }) {
      if (!turnId || !bridge || !prompt || !utterance || !Number.isSafeInteger(revision)) return false;
      if (current && current.turnId === turnId && current.revision > revision) return false;
      if (current && current.turnId === turnId && current.utterance === utterance && current.speechEpoch === speechEpoch) {
        current.revision = revision;
        return true;
      }
      cancel(current);
      const entry = { turnId, revision, speechEpoch, bridge, prompt, utterance, ready: false, cancelled: false, cancel: null };
      current = entry;
      const started = prewarm?.(utterance);
      if (!started) { entry.ready = true; return true; }
      entry.cancel = started.cancel ?? null;
      Promise.resolve(started.firstChunkReady).then((ready) => { if (!entry.cancelled) entry.ready = ready === true; }, () => {});
      return true;
    },

    /** The bridge to speak before `prompt` when it belongs to this turn and an epoch not newer than the final one, its spoken
     * utterance is exactly `utterance` and its audio is ready now (never waited for). */
    find({ turnId, speechEpoch, prompt, utteranceFor }) {
      const entry = current;
      if (!entry || entry.cancelled || !entry.ready || entry.turnId !== turnId || entry.prompt !== prompt) return null;
      if (Number.isSafeInteger(speechEpoch) && Number.isSafeInteger(entry.speechEpoch) && entry.speechEpoch > speechEpoch) return null;
      if (typeof utteranceFor === "function" && utteranceFor(entry.bridge) !== entry.utterance) return null;
      return entry.bridge;
    },

    /** Releases the held audio (a new answer starts, the room is left, or the turn was spoken). */
    clear() {
      cancel(current);
      current = null;
    },
  };
}

/**
 * After the one follow-up, a speculative preparation replaces the fixed path only when it is already ready, belongs to this
 * answer and its final speech epoch, analyzed exactly the final transcript and decided NEXT (a second follow-up never plays).
 * Nothing waits for it: otherwise the fixed path runs at once.
 */
export function canUsePostFollowUpPreparation({ value, currentTurnId, currentSpeechEpoch, finalTranscript }) {
  if (!value || value.turnId !== currentTurnId || value.speechEpoch !== currentSpeechEpoch) return false;
  if (value.decision?.decision !== "NEXT" || !value.decision.nextQuestion) return false;
  return String(value.transcript ?? "").trim() === String(finalTranscript ?? "").trim();
}
