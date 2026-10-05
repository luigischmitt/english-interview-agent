import { getQuestionBankForRole } from "./question-bank.mjs";
import { isValidJobDirection } from "./job-direction.mjs";
import { roleForSpeech } from "./opening-copy.mjs";
import type { InterviewConfig, InterviewQuestion } from "./types";

export function getFixedInterviewQuestions(config: InterviewConfig): InterviewQuestion[] {
  const role = config.role || "this role";
  // A role typed in Portuguese is never spliced into an English sentence ("strong fit for Analista de Dados").
  const spokenRole = roleForSpeech(role);
  const questions = getQuestionBankForRole(config.role).map((question) => ({ ...question, prompt: question.prompt.replace("{role}", spokenRole) }));
  const direction = config.jobDirection;
  if (questions[0] && isValidJobDirection(direction)
    && direction.targetRole.trim() === role.trim()
    && direction.suggestedSeniority === config.seniority) {
    questions[0] = {
      ...questions[0],
      prompt: "Based on the role description you shared, which part of your experience would be most valuable in this position?",
      cue: "Give a concise example, then connect it to the role.",
    };
  }
  return questions;
}
