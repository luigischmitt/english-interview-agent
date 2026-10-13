function latestInterviewDate(refs, interviewId) {
  return refs
    .filter((ref) => ref.interview_id === interviewId)
    .map((ref) => ref.created_at ?? "")
    .sort()
    .at(-1) ?? "";
}

function trendFor(refs, interviewIds) {
  if (interviewIds.length < 4) return null;
  const sortedIds = [...interviewIds].sort((a, b) => latestInterviewDate(refs, a).localeCompare(latestInterviewDate(refs, b)));
  const latest = new Set(sortedIds.slice(-3));
  const earlier = new Set(sortedIds.slice(0, -3));
  const rate = (ids) => refs.filter((ref) => ids.has(ref.interview_id)).length / Math.max(1, ids.size);
  const delta = rate(latest) - rate(earlier);
  return delta > 0.25 ? "up" : delta < -0.25 ? "down" : "steady";
}

/** Summarize recurring practice errors for each lesson. */
export function lessonStats(groups, lessons, now = new Date()) {
  const byKey = new Map((groups ?? []).map((group) => [group.theme_key, group]));
  const stats = (lessons ?? []).map((lesson, index) => {
    const refs = byKey.get(lesson.key)?.error_refs ?? [];
    const interviews = new Set(refs.map((ref) => ref.interview_id)).size;
    const counts = new Map();
    for (const ref of refs) {
      if (ref.ruleId) counts.set(ref.ruleId, (counts.get(ref.ruleId) ?? 0) + 1);
    }
    const parts = [...counts]
      .map(([ruleId, count]) => ({ ruleId, label: lesson.rules.find((rule) => rule.id === ruleId)?.label ?? ruleId, count }))
      .sort((a, b) => b.count - a.count);
    const dates = refs.map((ref) => ref.created_at).filter(Boolean).sort();
    const interviewIds = [...new Set(refs.map((ref) => ref.interview_id))];
    return {
      lessonKey: lesson.key,
      errors: refs.length,
      interviews,
      rank: null,
      lastErrorAt: dates.at(-1) ?? null,
      trend: trendFor(refs, interviewIds),
      topParts: parts,
      chapter: index + 1,
      now,
    };
  });
  stats
    .filter((item) => item.errors > 0)
    .sort((a, b) => b.errors - a.errors || (b.lastErrorAt ?? "").localeCompare(a.lastErrorAt ?? ""))
    .forEach((item, index) => { item.rank = index + 1; });
  return stats;
}

/** Return the most frequent lesson parts, ordered by count and recency. */
export function topParts(groups, lessons, n = 3) {
  const results = [];
  for (const lesson of lessons ?? []) {
    const refs = groups?.find((group) => group.theme_key === lesson.key)?.error_refs ?? [];
    for (const rule of lesson.rules ?? []) {
      const matching = refs
        .filter((ref) => ref.ruleId === rule.id)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      if (matching.length) {
        results.push({
          lessonKey: lesson.key,
          ruleId: rule.id,
          label: rule.label,
          count: matching.length,
          latestAt: matching[0].created_at ?? "",
          latest: { evidence: matching[0].evidence, rephrased: matching[0].rephrased },
        });
      }
    }
  }
  return results
    .sort((a, b) => b.count - a.count || b.latestAt.localeCompare(a.latestAt))
    .slice(0, n)
    .map((part) => ({
      lessonKey: part.lessonKey,
      ruleId: part.ruleId,
      label: part.label,
      count: part.count,
      latest: part.latest,
    }));
}

/** Return lessons with the most mistakes, including the latest sentence for each. */
export function topLessons(groups, lessons, n = 3) {
  const byKey = new Map((groups ?? []).map((group) => [group.theme_key, group]));
  return (lessons ?? []).flatMap((lesson) => {
    const refs = byKey.get(lesson.key)?.error_refs ?? [];
    if (!refs.length) return [];
    const latest = [...refs].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
    return [{ lessonKey: lesson.key, count: refs.length, interviews: new Set(refs.map((ref) => ref.interview_id)).size,
      latest: { evidence: latest.evidence, rephrased: latest.rephrased } }];
  }).sort((a, b) => b.count - a.count).slice(0, n);
}

/** Format an error timestamp as a compact Portuguese relative date. */
export function relativeErrorDate(timestamp, now = new Date()) {
  const errorDate = new Date(timestamp);
  if (Number.isNaN(errorDate.getTime())) return "";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const errorDay = new Date(errorDate.getFullYear(), errorDate.getMonth(), errorDate.getDate());
  const days = Math.max(0, Math.floor((today.getTime() - errorDay.getTime()) / 86400000));
  if (days === 0) return "hoje";
  if (days === 1) return "ontem";
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  return months === 1 ? "há 1 mês" : `há ${months} meses`;
}
