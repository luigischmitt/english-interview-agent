/** Longest bridge the backend accepts; the room speaks it before the question. */
export const maxAcknowledgementLength = 220;

/** Deterministic, content-free transitions for when the model call fails. Kept identical to the backend list. */
const fallbackTransitions = ["Thanks for that. Let's move on.", "Let's move to a different topic.", "Now I'd like to ask about something else.", "Let's switch gears for a moment.", "Let me ask about a different part of your work.", "Let's talk about something different.", "I'd like to change topics now.", "Next, let's look at another area."];

export function acknowledgementKey(value) {
  return value.toLocaleLowerCase().replace(/['’]/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Picks the least recently used transition (never-used first), so consecutive fallbacks rotate and avoid the recent ones. */
export function pickFallbackTransition(recentAcknowledgements = []) {
  const recent = recentAcknowledgements.map(acknowledgementKey);
  let best = fallbackTransitions[0];
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const candidate of fallbackTransitions) {
    const lastUsed = recent.lastIndexOf(acknowledgementKey(candidate));
    if (lastUsed < bestIndex) {
      best = candidate;
      bestIndex = lastUsed;
    }
  }
  return best;
}

export function fallbackTurnDecision(nextQuestion, recentAcknowledgements = []) {
  return { decision: "NEXT", followUpQuestion: null, nextQuestion, acknowledgement: nextQuestion ? pickFallbackTransition(recentAcknowledgements) : null };
}

/** A NEXT without a usable question from the backend falls back to the local fixed question with a neutral transition. */
export function normalizeNextTurnDecision(result, fallbackQuestion, recentAcknowledgements = []) {
  if (typeof result.nextQuestion === "string") {
    const acknowledgement = typeof result.acknowledgement === "string" && result.acknowledgement.trim() && result.acknowledgement.trim().length <= maxAcknowledgementLength ? result.acknowledgement.trim() : null;
    return { decision: "NEXT", followUpQuestion: null, nextQuestion: result.nextQuestion, acknowledgement };
  }
  return fallbackTurnDecision(fallbackQuestion, recentAcknowledgements);
}

/** The question to ask again when the candidate asked for a clarification the backend could not help with. */
export function repeatTurnDecision(source = "detector") {
  return { decision: "REPEAT", followUpQuestion: null, nextQuestion: null, acknowledgement: null, clarificationText: null, clarification: source };
}

function parseClarificationResponse(result) {
  if (result.followUpQuestion !== null || result.nextQuestion !== null) return null;
  const clarification = result.clarification === "detector" ? "detector" : "model";
  const text = typeof result.clarificationText === "string" ? result.clarificationText.trim() : null;
  if (result.decision === "REPEAT") return repeatTurnDecision(clarification);
  if (text === null || !text || /[\r\n]/u.test(text)) return null;
  if (result.decision === "REPHRASE" && text.length <= 220 && text.endsWith("?") && (text.match(/\?/g) ?? []).length === 1) {
    return { decision: "REPHRASE", followUpQuestion: null, nextQuestion: null, acknowledgement: null, clarificationText: text, clarification };
  }
  if (result.decision === "DEFINE" && text.length <= 160 && !text.includes("?")) {
    return { decision: "DEFINE", followUpQuestion: null, nextQuestion: null, acknowledgement: null, clarificationText: text, clarification };
  }
  return null;
}

function hasQuestionShape(value, maxLength) {
  const question = value.trim();
  return question.length > 0 && question.length <= maxLength && question.endsWith("?") && (question.match(/\?/g) ?? []).length === 1 && !/[\r\n]/.test(question);
}

/**
 * Shape-only check of the backend response (the backend owns semantic validation). Returns null when the response is
 * unusable so the caller uses the local fallback. A bridge is accepted up to 220 characters for both decisions and is
 * dropped when it repeats a recent acknowledgement.
 */
export function parseTurnDecisionResponse(result, { followUpUsed, recentAcknowledgements = [], fallbackQuestion }) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return null;
  if (result.decision === "REPEAT" || result.decision === "REPHRASE" || result.decision === "DEFINE") return parseClarificationResponse(result);
  const acknowledgement = result.acknowledgement === null ? null : typeof result.acknowledgement === "string" ? result.acknowledgement.trim() : undefined;
  if (acknowledgement === undefined || (acknowledgement !== null && acknowledgement.length > maxAcknowledgementLength)) return null;
  const recent = new Set(recentAcknowledgements.map(acknowledgementKey));
  const safeAcknowledgement = acknowledgement !== null && recent.has(acknowledgementKey(acknowledgement)) ? null : acknowledgement;
  if (result.decision === "NEXT" && result.followUpQuestion === null) {
    if (result.nextQuestion === null) return normalizeNextTurnDecision({ ...result, acknowledgement: safeAcknowledgement }, fallbackQuestion, recentAcknowledgements);
    if (typeof result.nextQuestion === "string" && hasQuestionShape(result.nextQuestion, 220)) {
      return { decision: "NEXT", followUpQuestion: null, nextQuestion: result.nextQuestion.trim(), acknowledgement: safeAcknowledgement };
    }
  }
  if (result.decision === "FOLLOW_UP" && !followUpUsed && result.nextQuestion === null && typeof result.followUpQuestion === "string" && hasQuestionShape(result.followUpQuestion, 180)) {
    return { decision: "FOLLOW_UP", followUpQuestion: result.followUpQuestion.trim(), nextQuestion: null, acknowledgement: safeAcknowledgement };
  }
  return null;
}
