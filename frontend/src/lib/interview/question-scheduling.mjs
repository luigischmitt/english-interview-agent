import { hasTimeForNextQuestion } from "./session-policy.mjs";

function isTailoredQuestion(question) {
  return question.id.startsWith("job-");
}

export function plannedQuestionType(question) {
  if (question?.id?.startsWith("job-")) return "job";
  if (question?.id?.startsWith("resume-")) return "resume";
  return "bank";
}

/** Resolve the fixed question selected by speculative analysis, including the identity of any skipped item. */
export function resolveSpeculativeFixedSelection(plannedQuestions, action, adaptedQuestion = null) {
  const first = plannedQuestions[0] ?? null;
  if (!first) return { question: null, skippedQuestionIds: [] };
  if (action === "SKIP" && !isTailoredQuestion(first) && plannedQuestions[1]) {
    return { question: plannedQuestions[1], skippedQuestionIds: [first.id] };
  }
  return {
    question: first,
    prompt: action === "DEEPEN" && typeof adaptedQuestion === "string" && adaptedQuestion.trim() ? adaptedQuestion.trim() : first.prompt,
    skippedQuestionIds: [],
  };
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

/** The two deterministic questions whose audio can be prepared while the candidate answers. */
export function selectNextPlannedQuestions(input, count = 2) {
  const plan = selectNextPlannedQuestion(input);
  return plan.question ? plan.remaining.slice(0, Math.max(0, count)) : [];
}
