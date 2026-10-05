// Pure policy for clarification turns ("can you repeat?", "I did not understand", "what does X mean?").
// A clarification is never an answer: it is not reported, analyzed or persisted, it does not consume the follow-up and it
// does not advance the question. The interviewer says the same question again (REPEAT), simpler (REPHRASE) or after a
// one-sentence explanation of a term (DEFINE). After `maxClarificationsPerQuestion` the interview moves on.

export const maxClarificationsPerQuestion = 2;
/** Repeated questions are spoken a bit slower (Kokoro/OpenRouter speech accept a `speed` parameter). */
export const repeatSpeechSpeed = 0.9;
export const repeatLeadIn = "Sure.";
export const rephraseLeadIn = "Let me put it another way.";
/** Neutral bridge when the candidate keeps asking: never blames the candidate. */
export const moveOnBridge = "Let's move on to the next one.";
export const maxDefinitionLength = 160;
export const maxRephraseLength = 220;

const clarificationDecisions = new Set(["REPEAT", "REPHRASE", "DEFINE"]);

export function isClarificationDecision(decision) {
  return Boolean(decision) && typeof decision === "object" && clarificationDecisions.has(decision.decision);
}

/** True while this question still has clarifications left; the next request after the limit moves the interview on. */
export function canClarifyAgain(clarificationsSoFar) {
  return clarificationsSoFar < maxClarificationsPerQuestion;
}

function lowerFirst(text) {
  return /^[A-Z][a-z]/u.test(text) ? `${text[0].toLocaleLowerCase()}${text.slice(1)}` : text;
}

function sentence(text) {
  const value = text.trim();
  return /[.!?]$/u.test(value) ? value : `${value}.`;
}

/**
 * What the interviewer says for a clarification decision. `question` is the question to ask again (the one the
 * candidate last heard). `base` is what a later REPEAT should repeat. An unusable REPHRASE/DEFINE text degrades to a
 * plain REPEAT, so the candidate always hears the question.
 */
export function composeClarificationTurn({ decision, clarificationText = null, question }) {
  const text = typeof clarificationText === "string" ? clarificationText.trim() : "";
  if (decision === "REPHRASE" && text && text.length <= maxRephraseLength && text.endsWith("?")) {
    return { acknowledgement: rephraseLeadIn, question: text, base: text, speed: 1 };
  }
  if (decision === "DEFINE" && text && text.length <= maxDefinitionLength && !text.includes("?") && !/[\r\n]/u.test(text)) {
    return { acknowledgement: sentence(text), question: `So, ${lowerFirst(question)}`, base: question, speed: 1 };
  }
  return { acknowledgement: repeatLeadIn, question, base: question, speed: repeatSpeechSpeed };
}

/** Assessment attempts recorded while the candidate was only asking for a clarification are excluded from pronunciation scores. */
export function assessmentContextKey(context) {
  return `${context.sequenceNumber}:${context.round ?? 0}`;
}

/**
 * What the room does with a decided turn. A real answer is recorded (`countsAsAnswer`); a clarification request never is.
 * The first `maxClarificationsPerQuestion` requests for a question are answered (`clarify`); the next one moves on with
 * a neutral bridge to `nextQuestion` (the caller picks the first planned question that was not asked yet).
 */
export function planTurnAfterDecision({ decision, clarificationsSoFar, nextQuestion }) {
  if (!isClarificationDecision(decision)) return { countsAsAnswer: true, clarify: false, turn: decision, clarificationsAfter: clarificationsSoFar };
  if (canClarifyAgain(clarificationsSoFar)) return { countsAsAnswer: false, clarify: true, turn: decision, clarificationsAfter: clarificationsSoFar + 1 };
  return {
    countsAsAnswer: false,
    clarify: false,
    turn: { decision: "NEXT", followUpQuestion: null, nextQuestion, acknowledgement: moveOnBridge },
    clarificationsAfter: clarificationsSoFar,
  };
}
