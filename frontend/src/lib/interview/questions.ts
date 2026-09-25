import type { InterviewConfig, InterviewQuestion } from "./types";

const fixedQuestions: InterviewQuestion[] = [
  { id: "introduction", prompt: "Tell me about your experience and what makes you a strong fit for {role}.", cue: "Give a concise overview, then connect one strength to the role." },
  { id: "recent-work", prompt: "Walk me through a recent project you worked on and the part you owned.", cue: "Set the context, explain your contribution, and finish with the outcome." },
  { id: "trade-off", prompt: "Tell me about a technical trade-off you had to make.", cue: "Name the options, the constraint, and why your decision was reasonable." },
  { id: "problem-solving", prompt: "Describe a difficult problem you solved when the path forward was unclear.", cue: "Focus on how you investigated the problem and what you learned." },
  { id: "collaboration", prompt: "Tell me about a disagreement with a teammate and how you handled it.", cue: "Show how you listened, communicated, and moved the work forward." },
  { id: "feedback", prompt: "What is a piece of feedback that changed the way you work?", cue: "Give the original feedback and one concrete behavior you changed." },
  { id: "impact", prompt: "How do you know when your work has made a meaningful impact?", cue: "Use a specific result or signal rather than only describing activity." },
  { id: "closing", prompt: "What would you like to ask about the team or the role?", cue: "Ask one thoughtful question that helps you evaluate the opportunity." },
];

export function getFixedInterviewQuestions(config: InterviewConfig): InterviewQuestion[] {
  const role = config.role || "this role";
  return fixedQuestions
    .map((question) => ({ ...question, prompt: question.prompt.replace("{role}", role) }));
}
