export type PracticeCategory = {
  key: string;
  title: string;
  explanation: string;
  why: string;
  examples: string[];
};
export const practiceCategories: PracticeCategory[];
export const practiceCategoryKeys: string[];
export const practiceCategoryByKey: Record<string, PracticeCategory>;
export function normalizePracticeAnswer(value: string): string;
