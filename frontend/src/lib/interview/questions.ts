import { getQuestionBankForRole } from "./question-bank.mjs";
import { isValidJobDirection } from "./job-direction.mjs";
import { roleForSpeech } from "./opening-copy.mjs";
import type { InterviewConfig, InterviewQuestion } from "./types";

export function getFixedInterviewQuestions(config: InterviewConfig): InterviewQuestion[] {
  const role = config.role || "this role";
  // A role typed in Portuguese is never spliced into an English sentence ("strong fit for Analista de Dados").
  const spokenRole = roleForSpeech(role);
  const questions = getQuestionBankForRole(config.role, config.seniority).map((question) => ({ ...question, prompt: question.prompt.replace("{role}", spokenRole) }));
  const direction = config.jobDirection;
  if (questions[0] && isValidJobDirection(direction)
    && direction.targetRole.trim() === role.trim()
    && direction.suggestedSeniority === config.seniority) {
    const fromResume = config.interviewSource === "resume";
    questions[0] = {
      ...questions[0],
      prompt: fromResume
        ? "Could you introduce yourself and briefly describe the experience most relevant to this role?"
        : "Based on the role description you shared, which part of your experience would be most valuable in this position?",
      cue: "Give a concise example, then connect it to the role.",
    };
    return applyTailoredQuestions(questions, direction.tailoredQuestions, fromResume ? "resume" : "job");
  }
  return questions;
}

// Bank order: [introduction, t1, t2, ownership, t3, conflict, t4, ...]. Tailored questions take the first technical slots.
const tailoredSlots = [1, 2, 3, 4, 5, 6, 7, 8];

function applyTailoredQuestions(questions: InterviewQuestion[], tailored: string[] | undefined, prefix: "job" | "resume"): InterviewQuestion[] {
  const used = new Set(questions.map((question) => question.prompt.trim().toLowerCase()));
  const slots = tailoredSlots;
  let slot = 0;
  (tailored ?? []).forEach((prompt) => {
    const key = prompt.trim().toLowerCase();
    if (slot >= slots.length || used.has(key)) return;
    questions[slots[slot]] = { id: `${prefix}-${slot + 1}`, prompt: prompt.trim(), cue: "Give a concrete example from your experience with this." };
    used.add(key);
    slot += 1;
  });
  // In a short interview, keep all source-specific questions immediately after the introduction.
  // Questions from the role bank retain their relative order after the tailored block.
  const tailoredPrefix = `${prefix}-`;
  return [questions[0], ...questions.slice(1).filter((question) => question.id.startsWith(tailoredPrefix)), ...questions.slice(1).filter((question) => !question.id.startsWith(tailoredPrefix))];
}
