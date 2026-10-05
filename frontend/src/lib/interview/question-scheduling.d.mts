import type { InterviewQuestion } from "./types";

export function remainingPlannedQuestions(questions: InterviewQuestion[], askedQuestionIds: Iterable<string>): InterviewQuestion[];
export function selectNextPlannedQuestion(input: {
  questions: InterviewQuestion[];
  askedQuestionIds: Iterable<string>;
  elapsedSeconds: number;
  durationMinutes: number;
}): { question: InterviewQuestion | null; index: number; remaining: InterviewQuestion[] };
