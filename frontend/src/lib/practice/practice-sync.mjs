export function errorKey(ref) { return `${ref.interview_id}|${ref.sequence_number}|${ref.evidence}`; }
export function findMissingErrors(errors, themes) {
  const known = new Set(themes.flatMap((theme) => (theme.error_refs ?? []).map(errorKey)));
  return errors.filter((error) => !known.has(errorKey(error))).sort((a, b) => Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "")).slice(0, 20);
}
export function mergeRefs(existing = [], incoming = []) {
  const byKey = new Map(existing.map((ref) => [errorKey(ref), ref]));
  incoming.forEach((ref) => byKey.set(errorKey(ref), ref));
  return [...byKey.values()].slice(-200);
}
export function applyPracticeResult(theme, verdict) {
  const correct_streak = verdict === "correct" ? theme.correct_streak + 1 : 0;
  return { correct_streak, status: correct_streak >= 3 ? "mastered" : theme.status === "mastered" ? "active" : theme.status };
}
export function sortThemes(themes) {
  return [...themes].filter((theme) => theme.theme_key !== "_ignored" && theme.status !== "hidden").sort((a, b) => Number(b.status !== "mastered") - Number(a.status !== "mastered") || b.weighted_frequency - a.weighted_frequency || Date.parse(b.last_error_at ?? "") - Date.parse(a.last_error_at ?? ""));
}
