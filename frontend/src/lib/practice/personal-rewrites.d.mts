import type { PracticeLesson } from "./practice-lessons.mjs";

export type PersonalRewriteExercise = {
  id: string;
  lessonKey: string;
  ruleId: string;
  kind: "personal";
  sentence: string;
  answer: string;
  accepted: string[];
  context: string;
  why: string | null;
};

export function normalizePersonalAnswer(value: string): string;
export function buildPersonalRewriteTargets(
  groups: Array<{ theme_key: string; error_refs?: Array<Record<string, unknown>> }>,
  lessons: PracticeLesson[],
  recentIds?: string[],
  limit?: number,
): PersonalRewriteExercise[];
export function gradePersonalRewrite(exercise: Pick<PersonalRewriteExercise, "answer" | "accepted">, answer: string): {
  verdict: "correct" | "incorrect";
  corrected: string;
  feedback: "correct" | "incorrect";
};
export function shuffledPersonalWordBank(sentence: string, seed?: string): Array<{ id: number; text: string; trailing: string }>;
export function composePersonalWordBank(sentence: string, order: number[]): string;
