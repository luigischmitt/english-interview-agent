import { resolveInterviewerVoice } from "./voices.mjs";
import { resolveInterviewerSpeechSpeed } from "./interviewer-speech-speed.mjs";
import { buildRoleContext } from "./resume-neutral.mjs";
/** Keep the next-turn request on an explicit allowlist; raw job descriptions never enter orchestration. */
export function serializeNextTurnRequest(input) {
  const hint = input.clarificationHint ?? null;
  return JSON.stringify({
    currentQuestion: input.currentQuestion,
    transcript: input.transcript,
    nextFixedQuestion: input.nextFixedQuestion,
    remainingFixedQuestions: input.remainingFixedQuestions.slice(0, 4),
    followUpUsed: input.followUpUsed,
    askedQuestions: input.askedQuestions.map((question) => question.slice(0, 160)),
    recentAcknowledgements: input.recentAcknowledgements ?? [],
    previousAnswers: (input.previousAnswers ?? []).slice(-8).map((pair) => ({ question: pair.question.slice(0, 500), answer: pair.answer.slice(-300) })),
    ...(input.config.jobDirection && input.config.interviewSource !== "resume" ? { jobDirection: input.config.jobDirection } : {}),
    ...(input.config.focusWeakPoints ? { focusWeakPoints: input.config.focusWeakPoints } : {}),
    // The server pre-synthesizes the next utterance as soon as it decides; it must use the voice this client will ask for.
    voice: resolveInterviewerVoice(input.config.voice),
    speed: resolveInterviewerSpeechSpeed(input.config.speechSpeed),
    ...(hint ? { clarificationHint: hint } : {}),
    roleContext: buildRoleContext(input.config),
  });
}
