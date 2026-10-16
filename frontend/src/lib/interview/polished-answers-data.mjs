import { pairInterviewTurns } from "./report-metrics.mjs";

export function pairAnsweredQuestions(turns) {
  return pairInterviewTurns(turns);
}

export function mergeAnsweredQuestions(interviews, turnsByInterview) {
  const entries = interviews.flatMap((interview) => {
    const analysis = interview.analysis && typeof interview.analysis === "object" ? interview.analysis : {};
    const saved = analysis.polishedAnswers && typeof analysis.polishedAnswers === "object" ? analysis.polishedAnswers : {};
    return pairAnsweredQuestions(turnsByInterview.get(interview.id) ?? []).map((pair) => ({
      ...pair,
      interviewId: interview.id,
      targetRole: interview.target_role,
      completedAt: interview.completed_at ?? interview.created_at,
      polishedAnswer: saved[String(pair.sequenceNumber)] ?? null,
    }));
  });
  const newestFirst = entries.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || b.sequenceNumber - a.sequenceNumber);
  const seen = new Set();
  return newestFirst.filter((entry) => {
    const key = entry.question.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

export function mergeSavedPolishedAnswers(analysis, sequenceNumber, value) {
  const base = analysis && typeof analysis === "object" && !Array.isArray(analysis) ? analysis : {};
  const polishedAnswers = base.polishedAnswers && typeof base.polishedAnswers === "object" && !Array.isArray(base.polishedAnswers) ? base.polishedAnswers : {};
  return { ...base, polishedAnswers: { ...polishedAnswers, [String(sequenceNumber)]: value } };
}
