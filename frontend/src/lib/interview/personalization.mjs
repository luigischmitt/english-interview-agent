import { getQuestionBankForRole, technicalQuestionAlternates, technicalQuestionTopicIds } from "./question-bank.mjs";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const validText = (value) => typeof value === "string" && value.trim().length > 0;

function analysisOf(record) {
  const feedback = record?.feedback;
  return feedback?.status === "ready" && isRecord(feedback.analysis) ? feedback.analysis : null;
}

function roleMatches(recordRole, targetRole) {
  if (!validText(recordRole) || !validText(targetRole)) return true;
  return getQuestionBankForRole(recordRole) === getQuestionBankForRole(targetRole);
}

/**
 * Builds a local profile only from completed reports that carry a stable question-topic snapshot.
 * Legacy reports and malformed records are ignored safely because sequence numbers alone are ambiguous.
 */
export function buildLearnerQuestionProfile(records, targetRole) {
  if (!Array.isArray(records)) return [];
  const byTopic = new Map();
  for (const record of records) {
    if (record?.status !== "completed" || !roleMatches(record.targetRole, targetRole)) continue;
    const analysis = analysisOf(record);
    const snapshot = analysis?.technicalQuestionTopics;
    const gaps = analysis?.technicalContent?.gaps;
    if (!Array.isArray(snapshot) || !Array.isArray(gaps)) continue;
    const topicBySequence = new Map(snapshot
      .filter((item) => Number.isSafeInteger(item?.sequenceNumber) && item.sequenceNumber > 0 && validText(item?.topicId) && technicalQuestionTopicIds.has(item.topicId.trim()))
      .map((item) => [item.sequenceNumber, item.topicId.trim()]));
    const seenInSession = new Set();
    for (const gap of gaps) {
      const topicId = topicBySequence.get(gap?.sequenceNumber);
      if (!topicId || !validText(gap?.explanation) || seenInSession.has(topicId)) continue;
      seenInSession.add(topicId);
    }
    for (const topicId of seenInSession) {
      const entry = byTopic.get(topicId) ?? { topicId, sessionCount: 0, lastSeenAt: 0 };
      entry.sessionCount += 1;
      entry.lastSeenAt = Math.max(entry.lastSeenAt, Date.parse(record.completedAt ?? "") || Date.parse(record.createdAt ?? "") || 0);
      byTopic.set(topicId, entry);
    }
  }
  return [...byTopic.values()].sort((a, b) => b.sessionCount - a.sessionCount || b.lastSeenAt - a.lastSeenAt || a.topicId.localeCompare(b.topicId));
}

/** Apply up to two fixed, authored alternate phrasings to canonical technical questions. */
export function personalizeTechnicalQuestions(questions, profile, options = {}) {
  if (!Array.isArray(questions) || !Array.isArray(profile) || options.seniority === "junior") return questions;
  const eligible = new Set(profile.filter((item) => item?.sessionCount > 0 && validText(item.topicId)).map((item) => item.topicId));
  const selected = new Set();
  let substitutions = 0;
  return questions.map((question, index) => {
    // The introduction and source-tailored prompts are intentionally preserved.
    if (index === 0 || question.id.startsWith("job-") || question.id.startsWith("resume-") || substitutions >= 2) return question;
    const topicId = question.topicId ?? question.id;
    const alternate = technicalQuestionAlternates[topicId];
    if (!eligible.has(topicId) || !alternate || selected.has(topicId)) return question;
    selected.add(topicId);
    substitutions += 1;
    return { ...question, id: `${question.id}-alternate`, topicId, prompt: alternate.prompt, cue: alternate.cue };
  });
}

/** Snapshot only stable ids for exact authored prompts; adapted or user-provided prompts remain unlinked. */
export function createTechnicalQuestionSnapshot(questions, turns) {
  if (!Array.isArray(questions) || !Array.isArray(turns)) return [];
  const byPrompt = new Map(questions.filter(isRecord).map((question) => [String(question.prompt ?? "").trim().toLowerCase(), question]));
  const seen = new Set();
  return turns.flatMap((turn) => {
    const question = byPrompt.get(String(turn?.question ?? "").trim().toLowerCase());
    const topicId = question?.topicId ?? question?.id;
    if (!Number.isSafeInteger(turn?.sequenceNumber) || turn.sequenceNumber < 1 || !validText(topicId) || !technicalQuestionTopicIds.has(topicId) || question.id.startsWith("job-") || question.id.startsWith("resume-") || seen.has(turn.sequenceNumber)) return [];
    seen.add(turn.sequenceNumber);
    return [{ sequenceNumber: turn.sequenceNumber, topicId }];
  });
}

/** Count prior completed interviews with a matching stable topic id, excluding the report currently being shown. */
export function countPriorTopicGaps(records, targetRole, topicId, currentInterviewId) {
  if (!validText(topicId) || !Array.isArray(records)) return 0;
  return buildLearnerQuestionProfile(records.filter((record) => record?.id !== currentInterviewId), targetRole)
    .find((item) => item.topicId === topicId)?.sessionCount ?? 0;
}

/** Returns a compact current technical focus plus its measured prior-session recurrence when available. */
export function reportTechnicalFocus(report, records, targetRole, currentInterviewId) {
  const gaps = report?.technicalContent?.gaps;
  if (!Array.isArray(gaps)) return null;
  const currentGap = gaps.find((gap) => validText(gap?.explanation));
  if (!currentGap) return null;
  const topicSnapshot = Array.isArray(report?.technicalQuestionTopics) ? report.technicalQuestionTopics : [];
  const topicId = topicSnapshot.find((item) => item?.sequenceNumber === currentGap.sequenceNumber)?.topicId;
  if (!validText(topicId)) return null;
  return {
    focus: currentGap.explanation.trim(),
    priorSessionCount: topicId ? countPriorTopicGaps(records, targetRole, topicId, currentInterviewId) : 0,
  };
}
