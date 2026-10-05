import { getQuestionBankForRole } from "./question-bank.mjs";
import { isValidJobDirection } from "./job-direction.mjs";
import type { InterviewConfig, InterviewQuestion } from "./types";

export function getFixedInterviewQuestions(config: InterviewConfig): InterviewQuestion[] {
  const role = config.role || "this role";
  const questions = getQuestionBankForRole(config.role).map((question) => ({ ...question, prompt: question.prompt.replace("{role}", role) }));
  const direction = config.jobDirection;
  if (questions[0] && isValidJobDirection(direction)
    && direction.targetRole.trim() === role.trim()
    && direction.suggestedSeniority === config.seniority) {
    const competency = direction.priorityCompetencies[0].trim();
    questions[0] = {
      ...questions[0],
      prompt: `What experience with ${competency} would help you succeed in this role?`,
      cue: "Give a concise example, then connect it to the role.",
    };
  }
  return questions;
}
