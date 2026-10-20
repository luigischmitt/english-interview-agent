const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const cleanText = (value, max = 1_000) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;

/** Serialize the public report allowlist while retaining legacy compatibility. */
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
  return {
    locale: result.locale ?? "pt-BR",
    ...(result.jobDirection ? { jobDirection: result.jobDirection } : {}),
    ...(snapshot.length ? { technicalQuestionTopics: snapshot } : {}),
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
