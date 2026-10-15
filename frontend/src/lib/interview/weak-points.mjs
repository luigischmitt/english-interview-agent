const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const shortText = (value, limit) => typeof value === "string" ? value.trim().replace(/\s+/gu, " ").slice(0, limit) : "";

/** Compact, bounded context from the newest ready reports. Records are expected newest first, as returned by Progress. */
export function buildWeakPointsContext(records) {
  if (!Array.isArray(records)) return "";
  const ready = records.filter((record) => record?.status === "completed" && record?.feedback?.status === "ready" && isRecord(record.feedback.analysis)).slice(0, 3);
  if (ready.length === 0) return "";

  const gaps = [];
  const patterns = new Map();
  for (const record of ready) {
    const analysis = record.feedback.analysis;
    const topicBySequence = new Map((Array.isArray(analysis.technicalQuestionTopics) ? analysis.technicalQuestionTopics : [])
      .filter((item) => Number.isSafeInteger(item?.sequenceNumber) && typeof item?.topicId === "string")
      .map((item) => [item.sequenceNumber, shortText(item.topicId, 60)]));
    for (const gap of Array.isArray(analysis.technicalContent?.gaps) ? analysis.technicalContent.gaps : []) {
      const explanation = shortText(gap?.explanation, 180);
      const topic = topicBySequence.get(gap?.sequenceNumber);
      const summary = explanation ? `${topic ? `${topic}: ` : ""}${explanation}` : "";
      if (summary && !gaps.some((item) => item.toLowerCase() === summary.toLowerCase())) gaps.push(summary);
    }
    for (const pattern of Array.isArray(analysis.englishCommunication?.patterns) ? analysis.englishCommunication.patterns : []) {
      const type = shortText(pattern?.type, 40);
      const example = shortText(pattern?.evidence, 100);
      if (!type || !example) continue;
      const found = patterns.get(type) ?? { count: 0, example };
      found.count += 1;
      patterns.set(type, found);
    }
  }

  const lines = ["Technical gaps:", ...gaps.slice(0, 3).map((item) => `- ${item}`), "English patterns:", ...[...patterns.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, 3).map(([type, value]) => `- ${type}: ${value.example}`)];
  const output = lines.join("\n").slice(0, 1200).trim();
  if (!gaps.length && !patterns.size) return "No recurring technical gaps or English patterns were identified in the recent reports.";
  return output;
}
