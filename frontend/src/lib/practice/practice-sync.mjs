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

export function findMissingErrors(errors, themes) {
  const known = new Set(themes.flatMap((theme) => (theme.error_refs ?? []).map(errorKey)));
  return errors
    .filter((error) => !known.has(errorKey(error)))
    .sort((a, b) => safeDate(b.created_at) - safeDate(a.created_at))
    .slice(0, 20);
}

export function mergeRefs(existing = [], incoming = []) {
  const byKey = new Map(existing.map((ref) => [errorKey(ref), ref]));
  incoming.forEach((ref) => byKey.set(errorKey(ref), ref));
  return [...byKey.values()].slice(-200);
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

export function applyPracticeResult(theme, verdict) {
  const correct_streak = verdict === "correct" ? theme.correct_streak + 1 : 0;
  return { correct_streak, status: correct_streak >= 3 ? "mastered" : theme.status === "mastered" ? "active" : theme.status };
}

export function sortThemes(themes) {
  return [...themes]
    .filter((theme) => theme.theme_key !== "_ignored" && theme.status !== "hidden")
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
