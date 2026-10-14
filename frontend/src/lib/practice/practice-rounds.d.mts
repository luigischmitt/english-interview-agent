import type { PracticeFixedExercise, PracticeLesson } from "./practice-lessons.mjs";
import type { PersonalRewriteExercise } from "./personal-rewrites.mjs";
export type PracticeMode = "quick" | "focused" | "mine";
export type LocalGrade = { verdict: "correct" | "almost" | "incorrect"; corrected: string; feedback: string };
export type PracticeRoundExercise = PracticeFixedExercise | PersonalRewriteExercise;
export function buildRound(input: { mode: PracticeMode; lessons: PracticeLesson[]; key?: string; ruleId?: string; size?: number; weights?: Record<string, number>; lessonWeights?: Record<string, number>; missedIds?: string[]; recentIds?: string[]; personalTargets?: PersonalRewriteExercise[]; random?: () => number }): PracticeRoundExercise[];
export function requeueMissed(round: PracticeRoundExercise[], results: LocalGrade[]): PracticeRoundExercise[];
export function gradeLocally(exercise: PracticeFixedExercise, answer: string): LocalGrade;
