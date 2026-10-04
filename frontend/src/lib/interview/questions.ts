import { getQuestionBankForRole } from "./question-bank.mjs";
import type { InterviewConfig, InterviewQuestion } from "./types";

export function getFixedInterviewQuestions(config: InterviewConfig): InterviewQuestion[] {
  const role = config.role || "this role";
  return getQuestionBankForRole(config.role).map((question) => ({ ...question, prompt: question.prompt.replace("{role}", role) }));
}
