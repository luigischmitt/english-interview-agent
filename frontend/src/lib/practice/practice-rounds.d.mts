import type { PracticeFixedExercise, PracticeLesson } from "./practice-lessons.mjs";
export type PracticeMode = "quick" | "focused" | "mine";
export type LocalGrade = { verdict: "correct" | "almost" | "incorrect"; corrected: string; feedback: string };
export function buildRound(input: { mode: PracticeMode; lessons: PracticeLesson[]; key?: string; ruleId?: string; size?: number; weights?: Record<string, number>; missedIds?: string[]; recentIds?: string[]; random?: () => number }): PracticeFixedExercise[];
export function requeueMissed(round: PracticeFixedExercise[], results: LocalGrade[]): PracticeFixedExercise[];
export function gradeLocally(exercise: PracticeFixedExercise, answer: string): LocalGrade;
