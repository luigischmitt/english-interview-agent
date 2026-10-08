function normalizedWords(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

function containsNormalizedPhrase(haystack, needle) {
  const source = normalizedWords(haystack);
  const phrase = normalizedWords(needle);
  if (phrase.length === 0 || phrase.length > source.length) return false;
  return source.some((_, index) => phrase.every((word, offset) => source[index + offset] === word));
}

/** Whether a ready revision can safely serve the final answer without waiting for new analysis. */
export function canUseSpeculativePreparation({ value, finalTranscript, currentTurnId, featureEnabled, compatibility }) {
  if (!value || value.turnId !== currentTurnId) return false;
  if (compatibility === "COVERED" || compatibility === "INVALID" || compatibility === "NONE") return false;
  if (String(value.transcript ?? "").trim() === String(finalTranscript ?? "").trim()) return true;
  return featureEnabled === true
    && value.decision?.decision === "FOLLOW_UP"
    && typeof value.anchor === "string"
    && value.anchor.length > 0
    && containsNormalizedPhrase(finalTranscript, value.anchor)
    && compatibility === "OPEN";
}

/** Give speculative follow-up speech only the acknowledgement interval to become ready. */
export async function followUpSpeechReadyByAcknowledgement({ decision, speechReady, audioEnabled, acknowledgementIdle }) {
  if (decision?.decision !== "FOLLOW_UP" || audioEnabled !== true) return true;
  let ready = false;
  const synthesis = Promise.resolve(speechReady).then((value) => { ready = value === true; return ready; }, () => false);
  await Promise.race([synthesis, Promise.resolve(acknowledgementIdle)]);
  await Promise.resolve();
  return ready;
}
