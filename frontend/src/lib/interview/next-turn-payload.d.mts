import type { InterviewConfig } from "./types";

export function serializeNextTurnRequest(input: {
  config: Pick<InterviewConfig, "role" | "seniority" | "focus" | "jobDirection" | "voice" | "interviewSource">;
  currentQuestion: string;
  transcript: string;
  nextFixedQuestion: string | null;
  remainingFixedQuestions: string[];
  followUpUsed: boolean;
  askedQuestions: string[];
  recentAcknowledgements?: string[];
  previousAnswers?: Array<{ question: string; answer: string }>;
  clarificationHint?: "repeat" | "rephrase" | "define" | null;
}): string;
