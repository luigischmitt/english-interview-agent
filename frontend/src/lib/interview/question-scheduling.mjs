import { hasTimeForNextQuestion } from "./session-policy.mjs";

function isTailoredQuestion(question) {
  return question.id.startsWith("job-");
}

/** Keep every unasked planned question, with vacancy-tailored questions first and bank order stable within each group. */
export function remainingPlannedQuestions(questions, askedQuestionIds) {
  const asked = new Set(askedQuestionIds);
  const remaining = questions.filter((question) => !asked.has(question.id));
  return [
    ...remaining.filter(isTailoredQuestion),
    ...remaining.filter((question) => !isTailoredQuestion(question)),
  ];
}

/** Choose the next planned question deterministically, but never start one inside the final 30-second reserve. */
export function selectNextPlannedQuestion({ questions, askedQuestionIds, elapsedSeconds, durationMinutes }) {
  const remaining = remainingPlannedQuestions(questions, askedQuestionIds);
  if (!hasTimeForNextQuestion(elapsedSeconds, durationMinutes)) return { question: null, index: -1, remaining };
  const question = remaining[0] ?? null;
  return { question, index: question ? questions.findIndex((candidate) => candidate.id === question.id) : -1, remaining };
}
