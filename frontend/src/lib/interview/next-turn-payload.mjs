/** Keep the next-turn request on an explicit allowlist; raw job descriptions never enter orchestration. */
export function serializeNextTurnRequest(input) {
  const hint = input.clarificationHint ?? null;
  return JSON.stringify({
    currentQuestion: input.currentQuestion,
    transcript: input.transcript,
    nextFixedQuestion: input.nextFixedQuestion,
    remainingFixedQuestions: input.remainingFixedQuestions,
    followUpUsed: input.followUpUsed,
    askedQuestions: input.askedQuestions,
    recentAcknowledgements: input.recentAcknowledgements ?? [],
    previousAnswers: input.previousAnswers ?? [],
    ...(input.config.jobDirection ? { jobDirection: input.config.jobDirection } : {}),
    ...(hint ? { clarificationHint: hint } : {}),
    roleContext: { targetRole: input.config.role, seniority: input.config.seniority, focus: input.config.focus },
  });
}
