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
    return applyTailoredQuestions(questions, direction.tailoredQuestions);
  }
  return questions;
}

// Bank order: [introduction, t1, t2, ownership, t3, conflict, t4, ...]. Tailored questions take the first technical slots.
const technicalSlots = [1, 2, 4];

function applyTailoredQuestions(questions: InterviewQuestion[], tailored: string[] | undefined): InterviewQuestion[] {
  const used = new Set(questions.map((question) => question.prompt.trim().toLowerCase()));
  let slot = 0;
  (tailored ?? []).forEach((prompt) => {
    const key = prompt.trim().toLowerCase();
    if (slot >= technicalSlots.length || used.has(key)) return;
    questions[technicalSlots[slot]] = { id: `job-${slot + 1}`, prompt: prompt.trim(), cue: "Give a concrete example from your experience with this." };
    used.add(key);
    slot += 1;
  });
  // In a five-minute interview, keep all vacancy questions immediately after the introduction.
  // Questions from the role bank retain their relative order after the tailored block.
  return [questions[0], ...questions.slice(1).filter((question) => question.id.startsWith("job-")), ...questions.slice(1).filter((question) => !question.id.startsWith("job-"))];
}
