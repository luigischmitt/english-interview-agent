import { practiceLessonByKey } from "./practice-lessons.mjs";

/** Deep link that opens a Treinar lesson, optionally at one rule (part). */
export function practiceLink(lessonKey, ruleId) {
  const params = new URLSearchParams({ view: "train", lesson: lessonKey });
  if (ruleId) params.set("part", ruleId);
  return `/dashboard?${params.toString()}`;
}

/** Validates deep-link params: unknown lessons yield null; an unknown part is dropped. */
export function parsePracticeLink(lesson, part) {
  if (typeof lesson !== "string" || !Object.hasOwn(practiceLessonByKey, lesson)) return null;
  const rules = practiceLessonByKey[lesson].rules ?? [];
  return { lesson, part: typeof part === "string" && rules.some((rule) => rule.id === part) ? part : null };
}
