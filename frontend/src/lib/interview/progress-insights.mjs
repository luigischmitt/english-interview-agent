import { azureMetricReliability } from "./report-metrics.mjs";

/**
 * Pure aggregation for the progress screen. Input is the user's own persisted data only (completed interviews, their
 * answer counts and the saved v2 feedback). Nothing here is estimated: every number is a count, a ratio of counts or a
 * duration-weighted mean of the saved Azure summaries. No overall level, no percentile, no population comparison.
 */

export const patternTypes = ["GRAMMAR", "WORD_CHOICE", "FALSE_COGNATE", "STRUCTURE"];
export const patternTypeCopy = {
  GRAMMAR: { label: "Gramática", short: "Gramática" },
  WORD_CHOICE: { label: "Escolha de palavras", short: "Palavras" },
  FALSE_COGNATE: { label: "Falsos cognatos", short: "Falsos cognatos" },
  STRUCTURE: { label: "Estrutura da resposta", short: "Estrutura" },
};
export const voiceDimensionCopy = {
  accuracy: { label: "Precisão da pronúncia", short: "Precisão" },
  fluency: { label: "Fluência", short: "Fluência" },
  prosody: { label: "Entonação", short: "Entonação" },
};
/** Used only when no saved report priority carries an exercise for the topic. Marked as `default` in the UI. */
export const defaultExercises = {
  GRAMMAR: "Escolha uma resposta sua e regrave-a em voz alta cuidando só do tempo verbal e dos artigos; compare com a versão corrigida do relatório.",
  WORD_CHOICE: "Liste 3 expressões que você usou e troque cada uma por uma opção mais natural em inglês; use-as em uma nova resposta.",
  FALSE_COGNATE: "Anote os falsos cognatos que apareceram, escreva uma frase correta com cada um e pratique dizê-las sem olhar.",
  STRUCTURE: "Responda de novo em três passos: contexto, o que você fez e resultado. Fale por 60 segundos sem parar.",
};
const topicTitleByType = {
  GRAMMAR: "Gramática em respostas faladas",
  WORD_CHOICE: "Escolha de palavras mais naturais",
  FALSE_COGNATE: "Falsos cognatos do português",
  STRUCTURE: "Estrutura das respostas",
};

export const minAnswersForProfile = 3;
export const minSessionsForTrends = 3;
const usableEvidenceStatuses = new Set(["SUFFICIENT", "LIMITED", "NO_PATTERN_FOUND"]);
const recencyDecay = 0.85;
const steadyThreshold = 0.08;
const weeksShown = 8;
const maxSeriesPoints = 12;

const isText = (value) => typeof value === "string" && value.trim().length > 0;
const round = (value, digits = 0) => { const f = 10 ** digits; return Math.round(value * f) / f; };

function timestampOf(record) {
  for (const value of [record.completedAt, record.startedAt, record.createdAt]) {
    const time = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(time)) return time;
  }
  return null;
}

export function sessionDurationMs(record) {
  if (!record.startedAt || !record.completedAt) return null;
  const start = Date.parse(record.startedAt);
  const end = Date.parse(record.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

function readAnalysis(feedback) {
  if (!feedback || feedback.status !== "ready" || !feedback.analysis) return null;
  const analysis = feedback.analysis;
  return typeof analysis === "object" ? analysis : null;
}

/** Validated English patterns of one session, or null when the report cannot support pattern statistics. */
function validatedPatterns(analysis) {
  const english = analysis?.englishCommunication;
  if (!english || !Array.isArray(english.patterns)) return null;
  if (english.evidenceStatus !== undefined && !usableEvidenceStatuses.has(english.evidenceStatus)) return null;
  const review = analysis.evidenceReview?.englishPatterns;
  if (review && english.patterns.length > 0 && review.accepted === 0) return null;
  const seen = new Set();
  const result = [];
  for (const pattern of english.patterns) {
    if (!pattern || !patternTypes.includes(pattern.type)) continue;
    if (!isText(pattern.evidence) || !isText(pattern.suggestion) || !isText(pattern.rephrasedExample)) continue;
    const key = `${pattern.sequenceNumber}|${pattern.type}|${pattern.evidence.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      type: pattern.type,
      sequenceNumber: pattern.sequenceNumber,
      evidence: pattern.evidence.trim(),
      suggestion: pattern.suggestion.trim(),
      rephrasedExample: pattern.rephrasedExample.trim(),
    });
  }
  return result;
}

function normalizeSession(record) {
  const analysis = readAnalysis(record.feedback);
  const patterns = analysis ? validatedPatterns(analysis) : null;
  const answerCount = Number.isFinite(record.answerCount) ? Math.max(0, record.answerCount) : 0;
  const gaps = analysis?.technicalContent && Array.isArray(analysis.technicalContent.gaps) ? analysis.technicalContent.gaps.filter((gap) => isText(gap?.explanation)) : null;
  const priorities = analysis && Array.isArray(analysis.priorities) ? analysis.priorities.filter((p) => isText(p?.focus) && isText(p?.exercise)) : [];
  const voice = {};
  for (const dimension of Object.keys(voiceDimensionCopy)) {
    const metric = record.feedback?.azureSummary?.[dimension];
    voice[dimension] = { metric, reliability: azureMetricReliability(metric) };
  }
  const time = timestampOf(record);
  return {
    id: record.id,
    time,
    date: time === null ? null : new Date(time).toISOString(),
    role: record.targetRole || "",
    seniority: record.seniority || null,
    durationMs: sessionDurationMs(record),
    answerCount,
    reportStatus: record.feedback ? (analysis ? "ready" : record.feedback.status === "pending" ? "pending" : "unavailable") : "none",
    patterns, // null = no usable pattern evidence
    patternsUsable: patterns !== null && answerCount > 0,
    gaps,
    priorities,
    voice,
  };
}

const sortAscending = (a, b) => (a.time ?? 0) - (b.time ?? 0);

function dayLabel(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function startOfWeek(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  const sinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - sinceMonday);
  return date;
}

export function weeklySessions(sessions, now = Date.now()) {
  const current = startOfWeek(now);
  const weeks = [];
  for (let offset = weeksShown - 1; offset >= 0; offset -= 1) {
    const start = new Date(current);
    start.setDate(start.getDate() - offset * 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const count = sessions.filter((s) => s.time !== null && s.time >= start.getTime() && s.time < end.getTime()).length;
    weeks.push({ start: start.toISOString(), label: dayLabel(start.toISOString()), count });
  }
  return weeks;
}

function normalizeText(text) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokenSet(text) { return new Set(normalizeText(text).split(" ").filter((token) => token.length > 2)); }
function similar(a, b) {
  const first = tokenSet(a); const second = tokenSet(b);
  if (first.size === 0 || second.size === 0) return normalizeText(a) === normalizeText(b);
  let shared = 0;
  for (const token of first) if (second.has(token)) shared += 1;
  return shared / (first.size + second.size - shared) >= 0.6;
}

function trendOf(rateOlder, rateRecent) {
  if (rateOlder === null || rateRecent === null) return "unknown";
  const delta = rateRecent - rateOlder;
  if (Math.abs(delta) < steadyThreshold) return "steady";
  return delta > 0 ? "up" : "down";
}

function voiceAggregate(sessions) {
  const result = {};
  for (const dimension of Object.keys(voiceDimensionCopy)) {
    const reliable = sessions.filter((s) => s.voice[dimension].reliability === "ok");
    const totalMs = reliable.reduce((sum, s) => sum + s.voice[dimension].metric.totalDurationMs, 0);
    result[dimension] = reliable.length === 0 || totalMs <= 0
      ? null
      : { mean: round(reliable.reduce((sum, s) => sum + s.voice[dimension].metric.mean * s.voice[dimension].metric.totalDurationMs, 0) / totalMs), sessionCount: reliable.length, totalDurationMs: totalMs };
  }
  return result;
}

function buildDimensions(sessions) {
  const usable = sessions.filter((s) => s.patternsUsable);
  const answers = usable.reduce((sum, s) => sum + s.answerCount, 0);
  const dimensions = [];
  if (answers >= minAnswersForProfile) {
    for (const type of patternTypes) {
      const affected = usable.reduce((sum, s) => sum + new Set(s.patterns.filter((p) => p.type === type).map((p) => p.sequenceNumber)).size, 0);
      const clean = Math.max(0, answers - affected);
      dimensions.push({
        key: type,
        kind: "pattern",
        label: patternTypeCopy[type].short,
        fullLabel: patternTypeCopy[type].label,
        value: round((clean / answers) * 100),
        detail: `${clean} de ${answers} respostas sem ${patternTypeCopy[type].label.toLowerCase()} destacada(o) no relatório.`,
      });
    }
  }
  const voice = voiceAggregate(sessions);
  for (const [dimension, aggregate] of Object.entries(voice)) {
    if (!aggregate) continue;
    dimensions.push({
      key: dimension,
      kind: "voice",
      label: voiceDimensionCopy[dimension].short,
      fullLabel: voiceDimensionCopy[dimension].label,
      value: aggregate.mean,
      detail: `Média da avaliação de fala (Azure) em ${aggregate.sessionCount} ${aggregate.sessionCount === 1 ? "prática" : "práticas"}, ponderada pelo tempo de fala avaliado. Sinal experimental, não é seu nível de inglês.`,
    });
  }
  return { dimensions, analyzedAnswers: answers, analyzedSessions: usable.length };
}

function buildCommonErrors(sessions) {
  const usable = sessions.filter((s) => s.patternsUsable);
  const canTrend = usable.length >= minSessionsForTrends;
  const split = Math.floor(usable.length / 2);
  const older = usable.slice(0, split);
  const recent = usable.slice(split);
  const rateFor = (group, type) => {
    const answers = group.reduce((sum, s) => sum + s.answerCount, 0);
    if (answers === 0) return null;
    return group.reduce((sum, s) => sum + s.patterns.filter((p) => p.type === type).length, 0) / answers;
  };
  const totalAnswers = usable.reduce((sum, s) => sum + s.answerCount, 0);
  const errors = [];
  for (const type of patternTypes) {
    const occurrences = [];
    usable.forEach((session, index) => {
      for (const pattern of session.patterns) {
        if (pattern.type === type) occurrences.push({ ...pattern, sessionId: session.id, date: session.date, role: session.role, age: usable.length - 1 - index });
      }
    });
    if (occurrences.length === 0) continue;
    const seenExamples = new Set();
    const examples = [...occurrences].reverse().filter((o) => {
      const key = normalizeText(o.evidence);
      if (seenExamples.has(key)) return false;
      seenExamples.add(key);
      return true;
    }).slice(0, 2).map((o) => ({ evidence: o.evidence, suggestion: o.suggestion, rephrasedExample: o.rephrasedExample, date: o.date, role: o.role }));
    errors.push({
      type,
      label: patternTypeCopy[type].label,
      count: occurrences.length,
      sessionCount: new Set(occurrences.map((o) => o.sessionId)).size,
      rate: totalAnswers > 0 ? round(occurrences.length / totalAnswers, 2) : null,
      trend: canTrend ? trendOf(rateFor(older, type), rateFor(recent, type)) : "unknown",
      score: occurrences.reduce((sum, o) => sum + recencyDecay ** o.age, 0),
      examples,
    });
  }
  errors.sort((a, b) => b.count - a.count || b.score - a.score);
  const topCount = errors[0]?.count ?? 0;
  return errors.map((error) => ({ type: error.type, label: error.label, count: error.count, sessionCount: error.sessionCount, rate: error.rate, trend: error.trend, examples: error.examples, share: topCount ? round(error.count / topCount, 2) : 0 }));
}

function buildStudyTopics(sessions) {
  const withReport = sessions.filter((s) => s.reportStatus === "ready");
  const topics = [];
  const upsert = (candidate) => {
    const existing = topics.find((t) => t.kind === candidate.kind && (t.patternType ? t.patternType === candidate.patternType : !candidate.patternType && similar(t.title, candidate.title)));
    if (!existing) { topics.push(candidate); return; }
    existing.score += candidate.score;
    existing.count += candidate.count;
    existing.sessionIds = new Set([...existing.sessionIds, ...candidate.sessionIds]);
    if ((candidate.lastTime ?? 0) >= (existing.lastTime ?? 0)) {
      existing.lastTime = candidate.lastTime;
      if (candidate.exerciseSource === "report" || existing.exerciseSource === "default") { existing.exercise = candidate.exercise; existing.exerciseSource = candidate.exerciseSource; }
    }
    for (const focus of candidate.focuses) if (!existing.focuses.some((f) => similar(f, focus))) existing.focuses.push(focus);
  };
  withReport.forEach((session, index) => {
    const age = withReport.length - 1 - index;
    const weight = recencyDecay ** age;
    const typeBySequence = new Map();
    for (const pattern of session.patterns ?? []) typeBySequence.set(pattern.sequenceNumber, pattern.type);
    const perType = new Map();
    for (const pattern of session.patterns ?? []) perType.set(pattern.type, (perType.get(pattern.type) ?? 0) + 1);
    for (const [type, count] of perType) {
      upsert({ kind: "english", patternType: type, title: topicTitleByType[type], count, score: count * weight, sessionIds: new Set([session.id]), lastTime: session.time, exercise: defaultExercises[type], exerciseSource: "default", focuses: [] });
    }
    for (const priority of session.priorities) {
      const linkedType = priority.area === "ENGLISH_COMMUNICATION" ? typeBySequence.get(priority.sequenceNumber) : undefined;
      const exercise = priority.exercise.trim();
      const focus = priority.focus.trim();
      if (linkedType) {
        upsert({ kind: "english", patternType: linkedType, title: topicTitleByType[linkedType], count: 0, score: weight * 0.5, sessionIds: new Set([session.id]), lastTime: session.time, exercise, exerciseSource: "report", focuses: [focus] });
      } else {
        upsert({ kind: priority.area === "TECHNICAL_CONTENT" ? "technical" : "english", title: focus, count: 1, score: weight, sessionIds: new Set([session.id]), lastTime: session.time, exercise, exerciseSource: "report", focuses: [] });
      }
    }
  });
  const covered = (topic) => !topic.patternType && topics.some((other) => other.patternType && (other.focuses.some((focus) => similar(focus, topic.title)) || similar(other.exercise, topic.exercise)));
  const seenExercises = [];
  const isNewExercise = (topic) => {
    if (seenExercises.some((exercise) => similar(exercise, topic.exercise))) return false;
    seenExercises.push(topic.exercise);
    return true;
  };
  return topics
    .filter((topic) => !covered(topic))
    .sort((a, b) => b.score - a.score || (b.lastTime ?? 0) - (a.lastTime ?? 0))
    .filter(isNewExercise)
    .sort((a, b) => b.score - a.score || (b.lastTime ?? 0) - (a.lastTime ?? 0))
    .map((topic, index) => ({
      id: `${topic.kind}-${topic.patternType ?? index}`,
      kind: topic.kind,
      patternType: topic.patternType,
      title: topic.title,
      count: topic.count,
      sessionCount: topic.sessionIds.size,
      exercise: topic.exercise,
      exerciseSource: topic.exerciseSource,
      focuses: topic.focuses,
      rank: index + 1,
    }));
}

function pointsFrom(sessions, valueOf) {
  const points = [];
  for (const session of sessions) {
    const value = valueOf(session);
    if (value === null || value === undefined) continue;
    points.push({ id: session.id, date: session.date, label: dayLabel(session.date), value });
  }
  return points.slice(-maxSeriesPoints);
}

function buildSeries(sessions) {
  const series = {
    patterns: pointsFrom(sessions, (s) => (s.patternsUsable ? round(s.patterns.length / s.answerCount, 2) : null)),
    gaps: pointsFrom(sessions, (s) => (s.gaps && s.answerCount > 0 ? round(s.gaps.length / s.answerCount, 2) : null)),
  };
  for (const dimension of Object.keys(voiceDimensionCopy)) {
    series[dimension] = pointsFrom(sessions, (s) => (s.voice[dimension].reliability === "ok" ? round(s.voice[dimension].metric.mean) : null));
  }
  return series;
}

export function buildProgressInsights(records, { now = Date.now() } = {}) {
  const completed = (records ?? []).filter((r) => r && r.status === "completed");
  const sessions = completed.map(normalizeSession).sort(sortAscending);
  const latest = sessions[sessions.length - 1] ?? null;
  const known = sessions.filter((s) => s.durationMs !== null);
  const { dimensions, analyzedAnswers, analyzedSessions } = buildDimensions(sessions);
  const patternDimensions = dimensions.filter((d) => d.kind === "pattern");
  const attention = patternDimensions.length > 0 ? [...patternDimensions].sort((a, b) => a.value - b.value)[0] : null;
  const series = buildSeries(sessions);
  return {
    sessionCount: sessions.length,
    practiceMs: known.length > 0 ? known.reduce((sum, s) => sum + s.durationMs, 0) : null,
    answerCount: sessions.reduce((sum, s) => sum + s.answerCount, 0),
    latestRole: latest?.role || null,
    latestSeniority: latest?.seniority ?? null,
    lastPracticeAt: latest?.date ?? null,
    reportReadyCount: sessions.filter((s) => s.reportStatus === "ready").length,
    analyzedSessions,
    analyzedAnswers,
    dimensions,
    attentionDimension: attention && attention.value < 100 ? attention : null,
    commonErrors: buildCommonErrors(sessions),
    studyTopics: buildStudyTopics(sessions),
    series,
    weekly: weeklySessions(sessions, now),
    sessionsUntilTrends: Math.max(0, minSessionsForTrends - analyzedSessions),
    sessions: [...sessions].reverse().map((s) => ({
      id: s.id, date: s.date, role: s.role, seniority: s.seniority, durationMs: s.durationMs, answerCount: s.answerCount, reportStatus: s.reportStatus,
      patternCount: s.patternsUsable ? s.patterns.length : null,
    })),
  };
}
