export function fallbackTurnDecision(nextQuestion) {
  return { decision: "NEXT", followUpQuestion: null, nextQuestion, acknowledgement: null };
}

export function normalizeNextTurnDecision(result, fallbackQuestion) {
  const nextQuestion = typeof result.nextQuestion === "string" ? result.nextQuestion : fallbackQuestion;
  return fallbackTurnDecision(nextQuestion);
}
