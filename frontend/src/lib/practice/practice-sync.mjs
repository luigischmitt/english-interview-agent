import { practiceCategoryKeys } from "./practice-categories.mjs";
import { practiceLessonByKey } from "./practice-lessons.mjs";

export function errorKey(ref) {
  return `${ref.interview_id}|${ref.sequence_number}|${ref.evidence}`;
}

export function extractProgressErrors(records) {
  return records.flatMap((record) => {
    const analysis = record.feedback?.analysis ?? record.analysis;
    const hasStudyPlan = analysis && typeof analysis === "object" && Object.hasOwn(analysis, "studyPlan");
    if (hasStudyPlan) return extractStudyPlanErrors(record, analysis.studyPlan);
    return (record.patterns ?? []).map((pattern) => ({
      interview_id: record.id,
      sequence_number: pattern.sequenceNumber,
      evidence: pattern.evidence,
      rephrased: pattern.rephrasedExample,
      type: pattern.type,
      suggestion: pattern.suggestion,
      created_at: record.completedAt ?? record.createdAt,
    }));
  });
}

function extractStudyPlanErrors(record, studyPlan) {
  const patterns = record.patterns ?? [];
  const targets = studyPlan && typeof studyPlan === "object" && Array.isArray(studyPlan.targets) ? studyPlan.targets : [];
  const plannedByEvidence = new Map();
  for (const target of targets.slice(0, 3)) {
    if (!target || typeof target !== "object") continue;
    const lessonKey = target.lessonKey;
    const ruleId = target.ruleId;
    const lesson = practiceLessonByKey[lessonKey];
    const sourceEvidence = typeof target.sourceEvidence === "string" ? target.sourceEvidence.trim() : "";
    const correctedTarget = typeof target.correctedTarget === "string" ? target.correctedTarget.trim() : "";
    if (!lesson || !practiceCategoryKeys.includes(lessonKey) || !lesson.rules.some((rule) => rule.id === ruleId)) continue;
    if (!sourceEvidence || !correctedTarget || sourceEvidence.length > 500 || correctedTarget.length > 500) continue;
    const acceptedAnswers = Array.isArray(target.acceptedAnswers)
      ? [...new Set(target.acceptedAnswers.filter((answer) => typeof answer === "string").map((answer) => answer.trim()).filter((answer) => answer && answer.length <= 500))].slice(0, 5)
      : [];
    const pattern = patterns.find((item) => normalizedEvidence(item.evidence) === normalizedEvidence(sourceEvidence));
    if (!pattern) continue;
    const targetRef = {
      lessonKey,
      ruleId,
      sourceEvidence,
      correctedTarget,
      acceptedAnswers,
      ...(typeof target.context === "string" ? { context: target.context.slice(0, 500) } : {}),
      ...(typeof target.explanation === "string" ? { explanation: target.explanation.slice(0, 500) } : {}),
      ...(typeof target.why === "string" ? { why: target.why.slice(0, 500) } : {}),
    };
    plannedByEvidence.set(normalizedEvidence(pattern.evidence), {
      interview_id: record.id,
      sequence_number: pattern.sequenceNumber,
      evidence: pattern.evidence,
      rephrased: correctedTarget,
      type: pattern.type,
      suggestion: targetRef.explanation ?? targetRef.why ?? "",
      created_at: record.completedAt ?? record.createdAt,
      category: lessonKey,
      ruleId,
      studyPlanTarget: targetRef,
    });
  }
  return patterns.map((pattern) => plannedByEvidence.get(normalizedEvidence(pattern.evidence)) ?? ({
    interview_id: record.id,
    sequence_number: pattern.sequenceNumber,
    evidence: pattern.evidence,
    rephrased: pattern.rephrasedExample,
    type: pattern.type,
    suggestion: pattern.suggestion,
    created_at: record.completedAt ?? record.createdAt,
    category: broadCategoryFor(pattern.type),
    ruleId: null,
    studyPlanFallback: true,
  }));
}

function broadCategoryFor(type) {
  if (type === "WORD_CHOICE" || type === "FALSE_COGNATE") return "word-choice";
  if (type === "STRUCTURE") return "sentence-structure";
  return "other";
}

function normalizedEvidence(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

export function findPracticeSyncWork(errors, themes, limit = 20) {
  const known = new Map(themes
    .filter((theme) => theme.theme_key === "_ignored" || practiceCategoryKeys.includes(theme.theme_key))
    .flatMap((theme) => (theme.error_refs ?? []).map((ref) => [errorKey(ref), ref])));
  const legacy = themes.filter((theme) => !practiceCategoryKeys.includes(theme.theme_key) && theme.theme_key !== "_ignored");
  const legacyRefs = legacy.flatMap((theme) => (theme.error_refs ?? []).filter((ref) => !known.has(errorKey(ref))));
  const missing = errors.filter((error) => {
    const saved = known.get(errorKey(error));
    return !saved || (error.studyPlanTarget && !saved.studyPlanTarget);
  });
  const byKey = new Map();
  [...legacyRefs, ...missing].forEach((ref) => {
    const key = errorKey(ref);
    if (!byKey.has(key) || ref.studyPlanTarget) byKey.set(key, ref);
  });
  const work = [...byKey.values()]
    .sort((a, b) => safeDate(b.created_at) - safeDate(a.created_at))
    .slice(0, limit);
  return work;
}

/** Planned and deterministic fallback refs have a category already; only legacy errors need classification. */
export function partitionPracticeSyncWork(errors) {
  const planned = [];
  const classify = [];
  for (const ref of errors ?? []) {
    if (ref.studyPlanTarget && practiceCategoryKeys.includes(ref.studyPlanTarget.lessonKey)
      && practiceLessonByKey[ref.studyPlanTarget.lessonKey]?.rules.some((rule) => rule.id === ref.studyPlanTarget.ruleId)) {
      planned.push({ category: ref.studyPlanTarget.lessonKey, ref });
    } else if (ref.studyPlanFallback && practiceCategoryKeys.includes(ref.category)) {
      planned.push({ category: ref.category, ref });
    } else {
      classify.push(ref);
    }
  }
  return { planned, classify };
}

/** Rules payload for the classifier: every category with rules, at most 12 per category, rule text cut to 400 characters. */
export function buildClassifyRules(keys, rulesForKey) {
  const rules = {};
  for (const key of keys) {
    const list = (rulesForKey(key) ?? [])
      .filter((item) => item?.id && String(item.rule ?? "").trim())
      .slice(0, 12)
      .map((item) => ({ id: item.id, rule: String(item.rule).trim().slice(0, 400) }));
    if (list.length) rules[key] = list;
  }
  return rules;
}

/** A returned rule id counts only when it belongs to the rules of the given group. */
export function resolveRuleId(rules, category, ruleId) {
  return typeof ruleId === "string" && (rules[category] ?? []).some((item) => item.id === ruleId) ? ruleId : null;
}

/** Stored refs that never went through rule classification (the ruleId key is absent), newest first. Groups without rules are skipped. */
export function findRuleBackfillWork(themes, rules, limit = 20) {
  return themes
    .filter((theme) => practiceCategoryKeys.includes(theme.theme_key) && rules[theme.theme_key]?.length)
    .flatMap((theme) => (theme.error_refs ?? [])
      .filter((ref) => !Object.hasOwn(ref, "ruleId"))
      .map((ref) => ({ themeKey: theme.theme_key, ref })))
    .sort((a, b) => safeDate(b.ref.created_at) - safeDate(a.ref.created_at))
    .slice(0, limit);
}

/** Fills only ruleId on backfilled refs; each ref keeps its current group. Returns refs grouped by theme key. */
export function applyRuleBackfill(work, assignments, rules) {
  const byTheme = new Map();
  work.forEach(({ themeKey, ref }, index) => {
    const filled = { ...ref, ruleId: resolveRuleId(rules, themeKey, assignments[index]?.ruleId) };
    byTheme.set(themeKey, [...(byTheme.get(themeKey) ?? []), filled]);
  });
  return byTheme;
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
