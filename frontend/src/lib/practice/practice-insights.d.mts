import type { PracticeLesson } from "./practice-lessons.mjs";
export type PracticeGroupLike = { theme_key: string; error_refs?: Array<{ interview_id: string; created_at?: string; evidence?: string; rephrased?: string; ruleId?: string | null }> };
export function lessonStats(groups: PracticeGroupLike[], lessons: PracticeLesson[], now?: Date): Array<{ lessonKey: string; errors: number; interviews: number; rank: number | null; lastErrorAt: string | null; trend: "up" | "down" | "steady" | null; topParts: Array<{ ruleId: string; label: string; count: number }>; chapter: number; now: Date }>;
export function topParts(groups: PracticeGroupLike[], lessons: PracticeLesson[], n?: number): Array<{ lessonKey: string; ruleId: string; label: string; count: number; latest: { evidence?: string; rephrased?: string } }>;
export function topLessons(groups: PracticeGroupLike[], lessons: PracticeLesson[], n?: number): Array<{ lessonKey: string; count: number; interviews: number; latest: { evidence?: string; rephrased?: string } }>;
export function relativeErrorDate(timestamp: string | Date, now?: Date): string;
