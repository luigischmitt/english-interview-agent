import { practiceCategoryKeys } from "./practice-categories.mjs";

export function errorKey(ref) {
  return `${ref.interview_id}|${ref.sequence_number}|${ref.evidence}`;
}

export function extractProgressErrors(records) {
  return records.flatMap((record) => (record.patterns ?? []).map((pattern) => ({
    interview_id: record.id,
    sequence_number: pattern.sequenceNumber,
    evidence: pattern.evidence,
    rephrased: pattern.rephrasedExample,
    type: pattern.type,
    suggestion: pattern.suggestion,
    created_at: record.completedAt ?? record.createdAt,
  })));
}

export function findPracticeSyncWork(errors, themes, limit = 20) {
  const known = new Set(themes
    .filter((theme) => theme.theme_key === "_ignored" || practiceCategoryKeys.includes(theme.theme_key))
    .flatMap((theme) => (theme.error_refs ?? []).map(errorKey)));
  const legacy = themes.filter((theme) => !practiceCategoryKeys.includes(theme.theme_key) && theme.theme_key !== "_ignored");
  const legacyRefs = legacy.flatMap((theme) => (theme.error_refs ?? []).filter((ref) => !known.has(errorKey(ref))));
  const missing = errors.filter((error) => !known.has(errorKey(error)));
  const byKey = new Map();
  [...legacyRefs, ...missing].forEach((ref) => {
    const key = errorKey(ref);
    if (!byKey.has(key)) byKey.set(key, ref);
  });
  const work = [...byKey.values()]
    .sort((a, b) => safeDate(b.created_at) - safeDate(a.created_at))
    .slice(0, limit);
  return work;
}

export function completedLegacyThemeIds(themes) {
  const persisted = new Set(themes
    .filter((theme) => theme.theme_key === "_ignored" || practiceCategoryKeys.includes(theme.theme_key))
    .flatMap((theme) => (theme.error_refs ?? []).map(errorKey)));
  return themes
    .filter((theme) => !practiceCategoryKeys.includes(theme.theme_key) && theme.theme_key !== "_ignored")
    .filter((theme) => (theme.error_refs ?? []).every((ref) => persisted.has(errorKey(ref))))
    .map((theme) => theme.id);
}

export function mergeRefs(existing = [], incoming = []) {
  const byKey = new Map(existing.map((ref) => [errorKey(ref), ref]));
  incoming.forEach((ref) => byKey.set(errorKey(ref), ref));
  // The table keeps at most 200 refs per group: the newest ones matter for practice.
  return [...byKey.values()].sort((a, b) => safeDate(a.created_at) - safeDate(b.created_at)).slice(-200);
}

export function recencyWeight(ref, lastErrorAt = null, now = Date.now()) {
  const refTimestamp = parseDate(ref.created_at);
  const timestamp = refTimestamp ?? parseDate(lastErrorAt);
  if (timestamp === null) return 1;
  const ageInMonths = Math.max(0, (now - timestamp) / 86_400_000 / 30);
  return Math.pow(0.85, ageInMonths);
}

export function weightedFrequency(refs = [], lastErrorAt = null, now = Date.now()) {
  return refs.reduce((total, ref) => total + recencyWeight(ref, lastErrorAt, now), 0);
}

export function applyPracticeResult(theme, correct, total) {
  const correct_streak = Math.min(1000, (theme.correct_streak ?? 0) + 1);
  const mastered = total > 0 && correct / total >= 0.8;
  return { correct_streak, status: mastered || theme.status === "mastered" ? "mastered" : "active" };
}

export function sortPracticeGroups(groups) {
  return [...groups]
    .filter((theme) => practiceCategoryKeys.includes(theme.theme_key) && theme.status !== "hidden" && (theme.error_refs ?? []).length > 0)
    .sort((a, b) => Number(b.status !== "mastered") - Number(a.status !== "mastered")
      || b.weighted_frequency - a.weighted_frequency
      || safeDate(b.last_error_at) - safeDate(a.last_error_at));
}

function parseDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function safeDate(value) {
  return parseDate(value) ?? 0;
}
