import type { InterviewQuestion } from "./types";

export type PlannedQuestionType = "resume" | "job" | "bank";
export function plannedQuestionType(question: Pick<InterviewQuestion, "id">): PlannedQuestionType;
export function resolveSpeculativeFixedSelection(
  plannedQuestions: InterviewQuestion[],
  action: "KEEP" | "SKIP" | "DEEPEN" | undefined,
  adaptedQuestion?: string | null,
  secondAction?: "KEEP" | "SKIP" | "DEEPEN",
  adaptedSecondQuestion?: string | null,
  committedSkippedQuestionIds?: Iterable<string>,
): { question: InterviewQuestion | null; prompt?: string; adapted?: boolean; originalPrompt?: string; skippedQuestionIds: string[] };
export function resolveFixedPromptForAudio(selection: { prompt?: string; originalPrompt?: string; adapted?: boolean }, firstChunkReady: boolean): string | undefined;
export function resolveMonotonicFixedAction(question: Pick<InterviewQuestion, "id"> | null, skipAlreadyCommitted: boolean, action: "KEEP" | "SKIP" | "DEEPEN"): { action: "KEEP" | "SKIP" | "DEEPEN"; skipCommitted: boolean };
export function shouldUseMonotonicFixedFallback(state?: { speculationAttempted?: boolean; speculationEnabled?: boolean; skipCommitted?: boolean }): boolean;

export function remainingPlannedQuestions(questions: InterviewQuestion[], askedQuestionIds: Iterable<string>): InterviewQuestion[];
export function selectNextPlannedQuestion(input: {
  questions: InterviewQuestion[];
  askedQuestionIds: Iterable<string>;
  elapsedSeconds: number;
  durationMinutes: number;
}): { question: InterviewQuestion | null; index: number; remaining: InterviewQuestion[] };
export function selectNextPlannedQuestions(input: {
  questions: InterviewQuestion[];
  askedQuestionIds: Iterable<string>;
  elapsedSeconds: number;
  durationMinutes: number;
}, count?: number): InterviewQuestion[];
