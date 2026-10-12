export type PracticeLessonRule = { id: string; label: string; when: string; examples: string[]; tip?: string };
export type PracticeLesson = { key: string; title: string; subtitle: string; intro: string; rules: PracticeLessonRule[] };
export const practiceLessons: PracticeLesson[];
export const practiceLessonByKey: Record<string, PracticeLesson>;
export const practiceRuleById: Record<string, PracticeLessonRule>;
export function lessonRulesForRequest(key: string): Array<{ id: string; rule: string }>;
