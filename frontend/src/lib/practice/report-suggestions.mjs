import { practiceLessonByKey, practiceRuleById } from "./practice-lessons.mjs";
import { practiceLink } from "./practice-links.mjs";

/**
 * Builds up to `limit` "study this now" suggestions from synced practice groups,
 * using only the error refs that belong to one interview. Pure.
 */
export function buildReportSuggestions(groups, interviewId, limit = 3) {
  if (!interviewId || !Array.isArray(groups)) return [];
  const buckets = new Map();
  for (const group of groups) {
    if (!group || group.theme_key === "_ignored") continue;
    const lesson = Object.hasOwn(practiceLessonByKey, group.theme_key) ? practiceLessonByKey[group.theme_key] : null;
    if (!lesson) continue;
    for (const ref of group.error_refs ?? []) {
      if (ref.interview_id !== interviewId || (ref.category && ref.category !== group.theme_key)) continue;
      const ruleId = ref.ruleId && Object.hasOwn(practiceRuleById, ref.ruleId) && lesson.rules.some((rule) => rule.id === ref.ruleId) ? ref.ruleId : null;
      const key = `${group.theme_key}::${ruleId ?? ""}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.count += 1;
      else buckets.set(key, { lesson, ruleId, evidence: ref.evidence, rephrased: ref.rephrased, count: 1, order: buckets.size, seq: ref.sequence_number ?? 0 });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, limit)
    .map(({ lesson, ruleId, evidence, rephrased, count }) => ({
      lessonKey: lesson.key,
      ruleId,
      lessonTitle: lesson.title,
      partLabel: ruleId ? practiceRuleById[ruleId].label : null,
      evidence,
      rephrased,
      count,
      href: practiceLink(lesson.key, ruleId),
    }));
}
