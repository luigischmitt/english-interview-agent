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
export function resolveSpeculativeFixedSelection(plannedQuestions, action, adaptedQuestion = null, secondAction = undefined, adaptedSecondQuestion = null, committedSkippedQuestionIds = []) {
  const first = plannedQuestions[0] ?? null;
  if (!first) return { question: null, skippedQuestionIds: [] };
  const committed = new Set(committedSkippedQuestionIds);
  const firstCanSkip = !isTailoredQuestion(first) && plannedQuestions[1] !== undefined;
  const firstSkipped = committed.has(first.id) || (action === "SKIP" && firstCanSkip);
  if (firstSkipped && plannedQuestions[1]) {
    const second = plannedQuestions[1];
    const secondCanSkip = !isTailoredQuestion(second) && plannedQuestions[2] !== undefined;
    const secondSkipped = committed.has(second.id) || (secondAction === "SKIP" && secondCanSkip);
    if (secondSkipped && plannedQuestions[2]) {
      const skippedQuestionIds = [...committed, first.id, second.id].filter((id, index, all) => all.indexOf(id) === index);
      return {
        question: plannedQuestions[2],
        prompt: plannedQuestions[2].prompt,
        adapted: false,
        originalPrompt: plannedQuestions[2].prompt,
        skippedQuestionIds,
      };
    }
    const skippedQuestionIds = [...committed, first.id].filter((id, index, all) => all.indexOf(id) === index);
    return {
      question: second,
      prompt: secondAction === "DEEPEN" && typeof adaptedSecondQuestion === "string" && adaptedSecondQuestion.trim() ? adaptedSecondQuestion.trim() : second.prompt,
      adapted: secondAction === "DEEPEN" && typeof adaptedSecondQuestion === "string" && Boolean(adaptedSecondQuestion.trim()),
      originalPrompt: second.prompt,
      skippedQuestionIds,
    };
  }
  const skippedQuestionIds = [...committed].filter((id) => plannedQuestions.some((question) => question.id === id));
  return {
    question: first,
    prompt: action === "DEEPEN" && typeof adaptedQuestion === "string" && adaptedQuestion.trim() ? adaptedQuestion.trim() : first.prompt,
    adapted: action === "DEEPEN" && typeof adaptedQuestion === "string" && Boolean(adaptedQuestion.trim()),
    originalPrompt: first.prompt,
    skippedQuestionIds,
  };
}

export function resolveFixedPromptForAudio({ prompt, originalPrompt, adapted }, firstChunkReady) {
  return adapted && !firstChunkReady ? originalPrompt : prompt;
}

export function resolveMonotonicFixedAction(question, skipAlreadyCommitted, action) {
  const canSkip = question && !isTailoredQuestion(question);
  const skipCommitted = Boolean(skipAlreadyCommitted || (canSkip && action === "SKIP"));
  return { action: canSkip && skipCommitted ? "SKIP" : action, skipCommitted };
}

/**
 * Once speculation was attempted in an answer (and the feature is enabled), finalization never waits for a full
 * `decideNextTurn`: it uses the pre-synthesized fixed question with committed skips. The legacy decision call is only for
 * answers where speculation is disabled or unavailable for the whole answer.
 */
export function shouldUseMonotonicFixedFallback({ speculationAttempted, speculationEnabled, skipCommitted } = {}) {
  return skipCommitted === true || (speculationAttempted === true && speculationEnabled === true);
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
