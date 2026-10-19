import { buildInterviewReportRequest } from "./report-request.mjs";

const patternTypes = new Set(["GRAMMAR", "WORD_CHOICE", "FALSE_COGNATE", "STRUCTURE"]);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const cleanText = (value, max = 1_000) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;

function validatedPatterns(report) {
  if (!Array.isArray(report?.englishCommunication?.patterns)) return [];
  return report.englishCommunication.patterns.flatMap((pattern) => {
    if (!patternTypes.has(pattern?.type)) return [];
    const evidence = cleanText(pattern.evidence);
    const rephrasedExample = cleanText(pattern.rephrasedExample);
    return evidence && rephrasedExample ? [{ type: pattern.type, evidence, rephrasedExample }] : [];
  }).slice(0, 12);
}

function validatedTechnicalGaps(report) {
  if (!Array.isArray(report?.technicalContent?.gaps)) return [];
  return report.technicalContent.gaps.flatMap((gap) => {
    const evidence = cleanText(gap?.evidence);
    const explanation = cleanText(gap?.explanation);
    if (!evidence || !explanation) return [];
    const vacancyCompetency = cleanText(gap.vacancyCompetency, 300);
    return [{ evidence, explanation, ...(vacancyCompetency ? { vacancyCompetency } : {}) }];
  }).slice(0, 8);
}

/** Only bounded report evidence and the approved role snapshot leave the browser for this one-shot request. */
export function buildInterviewStudyPlanPayload(config, report) {
  const context = buildInterviewReportRequest(config, {}, "pt-BR");
  return {
    roleContext: context.roleContext,
    ...(context.jobDirection ? { jobDirection: context.jobDirection } : {}),
    patterns: validatedPatterns(report),
    technicalGaps: validatedTechnicalGaps(report),
  };
}

function normalizeTarget(value) {
  if (!isRecord(value) || value.category !== "ENGLISH_COMMUNICATION") return null;
  const lessonKey = cleanText(value.lessonKey, 80);
  const ruleId = cleanText(value.ruleId, 120);
  const explanation = cleanText(value.explanation, 500);
  const why = cleanText(value.why, 500);
  const sourceEvidence = cleanText(value.sourceEvidence, 1_000);
  const correctedTarget = cleanText(value.correctedTarget, 1_000);
  if (!lessonKey || !ruleId || !explanation || !why || !sourceEvidence || !correctedTarget) return null;
  if (!Array.isArray(value.acceptedAnswers) || value.acceptedAnswers.length < 1 || value.acceptedAnswers.length > 8) return null;
  const acceptedAnswers = value.acceptedAnswers.map((answer) => cleanText(answer, 300));
  if (acceptedAnswers.some((answer) => !answer)) return null;
  return { category: "ENGLISH_COMMUNICATION", lessonKey, ruleId, explanation, why, sourceEvidence, correctedTarget, acceptedAnswers };
}

/** Invalid model/service output is ignored as a whole; callers keep the report and do not retry. */
export function normalizeInterviewStudyPlan(value) {
  if (!isRecord(value) || !Array.isArray(value.targets) || value.targets.length > 3) return null;
  const targets = value.targets.map(normalizeTarget);
  if (targets.some((target) => !target)) return null;
  return { targets };
}

/** One bounded request; every failure is converted to null and there is deliberately no retry. */
export async function requestInterviewStudyPlan(config, report, fetcher, endpoint = "http://localhost:3001") {
  if (validatedPatterns(report).length === 0) return { targets: [] };
  if (typeof fetcher !== "function") return null;
  try {
    const response = await fetcher(`${endpoint}/api/v1/thinking/study-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInterviewStudyPlanPayload(config, report)),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return normalizeInterviewStudyPlan(body);
  } catch {
    return null;
  }
}

/** Serialize the public report allowlist, including new optional fields without losing legacy compatibility. */
export function serializeInterviewAnalysis(result) {
  const turns = Array.isArray(result.turns) ? result.turns.filter((turn) => Number.isSafeInteger(turn?.sequenceNumber) && turn.sequenceNumber > 0 && Array.isArray(turn.technicalStrengths) && Array.isArray(turn.technicalGaps) && Array.isArray(turn.englishPatterns)).map((turn) => ({ sequenceNumber: turn.sequenceNumber, technicalStrengths: turn.technicalStrengths, technicalGaps: turn.technicalGaps, englishPatterns: turn.englishPatterns })) : [];
  const analysisCoverage = result.analysisCoverage && Number.isSafeInteger(result.analysisCoverage.analyzedTurnCount) && result.analysisCoverage.analyzedTurnCount >= 0
    && Number.isSafeInteger(result.analysisCoverage.totalTurnCount) && result.analysisCoverage.totalTurnCount >= result.analysisCoverage.analyzedTurnCount
    && Array.isArray(result.analysisCoverage.missingSequenceNumbers) && result.analysisCoverage.missingSequenceNumbers.every((sequenceNumber) => Number.isSafeInteger(sequenceNumber) && sequenceNumber > 0)
    ? { analyzedTurnCount: result.analysisCoverage.analyzedTurnCount, totalTurnCount: result.analysisCoverage.totalTurnCount, missingSequenceNumbers: result.analysisCoverage.missingSequenceNumbers }
    : null;
  const snapshot = Array.isArray(result.technicalQuestionTopics)
    ? result.technicalQuestionTopics.filter((item) => Number.isSafeInteger(item?.sequenceNumber) && item.sequenceNumber > 0 && cleanText(item.topicId, 120))
      .map(({ sequenceNumber, topicId }) => ({ sequenceNumber, topicId: topicId.trim() }))
    : [];
  const studyPlan = normalizeInterviewStudyPlan(result.studyPlan);
  return {
    locale: result.locale ?? "pt-BR",
    ...(result.jobDirection ? { jobDirection: result.jobDirection } : {}),
    ...(snapshot.length ? { technicalQuestionTopics: snapshot } : {}),
    ...(studyPlan ? { studyPlan } : {}),
    ...(turns.length ? { turns } : {}),
    ...(analysisCoverage ? { analysisCoverage } : {}),
    evidenceReview: result.evidenceReview,
    ...(isRecord(result.interviewerTakeaway) ? { interviewerTakeaway: result.interviewerTakeaway } : {}),
    ...(isRecord(result.overview) && (cleanText(result.overview.technical, 500) || cleanText(result.overview.english, 500)) ? { overview: { ...(cleanText(result.overview.technical, 500) ? { technical: cleanText(result.overview.technical, 500) } : {}), ...(cleanText(result.overview.english, 500) ? { english: cleanText(result.overview.english, 500) } : {}) } } : {}),
    technicalContent: result.technicalContent,
    englishCommunication: result.englishCommunication,
    priorities: result.priorities,
  };
}
