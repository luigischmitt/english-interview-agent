
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const cleanText = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const patternTypeLabels = {
  GRAMMAR: "Gramática",
  WORD_CHOICE: "Escolha de palavras",
  FALSE_COGNATE: "Falso cognato",
  STRUCTURE: "Estrutura",
};

function timeOf(record) {
  for (const value of [record?.completedAt, record?.startedAt, record?.createdAt]) {
    const time = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function takeawayFrom(analysis) {
  if (!isRecord(analysis)) return null;

  const interviewerTakeaway = isRecord(analysis.interviewerTakeaway) ? analysis.interviewerTakeaway : null;
  const overview = isRecord(analysis.overview) ? analysis.overview : null;
  const technicalContent = isRecord(analysis.technicalContent) ? analysis.technicalContent : null;

  return cleanText(interviewerTakeaway?.remember)
    ?? cleanText(analysis.summary)
    ?? cleanText(overview?.english)
    ?? cleanText(overview?.technical)
    ?? cleanText(technicalContent?.summary);
}

function patternFrom(analysis) {
  if (!isRecord(analysis) || !isRecord(analysis.englishCommunication)) return null;
  const patterns = analysis.englishCommunication.patterns;
  if (!Array.isArray(patterns)) return null;
  const pattern = patterns.find((item) => isRecord(item) && cleanText(item.suggestion));
  if (!pattern) return null;
  const type = cleanText(pattern.type);
  return { type: type ? patternTypeLabels[type] ?? type : null, suggestion: cleanText(pattern.suggestion) };
}

/** Derives the small, truthful home summary from records already loaded for Progress. */
export function buildHomeInsights(input) {
  const records = (Array.isArray(input) ? input : [])
    .filter((record) => record?.status === "completed")
    .slice()
    .sort((first, second) => timeOf(second) - timeOf(first));
  const latest = records[0] ?? null;
  return {
    interviewCount: records.length,
    lastInterviewAt: timeOf(latest) ? new Date(timeOf(latest)).toISOString() : null,
    lastReportReady: latest?.feedback?.status === "ready",
    lastTakeaway: takeawayFrom(latest?.feedback?.analysis),
    topPattern: patternFrom(latest?.feedback?.analysis),
  };
}
