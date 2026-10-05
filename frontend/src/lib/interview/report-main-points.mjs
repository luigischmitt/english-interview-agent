/**
 * Main view of a saved report: a few English and technical points plus priorities.
 * Works for new (already capped) and legacy (up to 8 items per list) reports, so it
 * only reads fields that have always existed and caps again defensively.
 */
export const mainPointLimits = { english: 4, technical: 3, priorities: 3 };

const knownMishearing = /\b(?:super\s?base|versal|vercell|to hospital|(?:they|we|you)['’]?re stained)\b/iu;
const trivialStrength = /\b(?:mencion(?:ou|ado|ar)|cit(?:ou|ado)|listou|nomeou|falou (?:sobre|de))\b|\b(?:trabalhou|participou|atuou) (?:em|de) (?:v[áa]rios|diversos|muitos) projetos?\b/iu;
const englishSentence = /\b(?:the candidate|did not|does not|their|clearly state)\b/iu;

/** Legacy text used "O candidato"; the report speaks to the user as "você". */
export function toSecondPerson(text) {
  return String(text ?? "").replace(/\b(?:[Oo]|[Aa]) (?:candidato|candidata|entrevistado|entrevistada)\b/gu, (match) => (match[0] === match[0].toUpperCase() ? "Você" : "você"));
}

function usableEvidence(item) {
  return typeof item?.evidence === "string" && !knownMishearing.test(item.evidence);
}

function usableText(text) {
  return typeof text === "string" && text.trim().length > 0 && !englishSentence.test(text);
}

export function deriveMainPoints(analysis) {
  const patterns = Array.isArray(analysis?.englishCommunication?.patterns) ? analysis.englishCommunication.patterns : [];
  const seen = new Set();
  const english = [];
  for (const pattern of patterns) {
    if (!usableEvidence(pattern) || !usableText(pattern.suggestion)) continue;
    const key = `${pattern.type}:${String(pattern.evidence).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    english.push({ ...pattern, suggestion: toSecondPerson(pattern.suggestion) });
    if (english.length >= mainPointLimits.english) break;
  }

  const technicalContent = analysis?.technicalContent;
  const gaps = (Array.isArray(technicalContent?.gaps) ? technicalContent.gaps : []).filter((item) => usableEvidence(item) && usableText(item.explanation));
  const strengths = (Array.isArray(technicalContent?.strengths) ? technicalContent.strengths : []).filter((item) => usableEvidence(item) && usableText(item.explanation) && !trivialStrength.test(item.explanation));
  const technical = [
    ...gaps.map((item) => ({ ...item, kind: "gap", explanation: toSecondPerson(item.explanation) })),
    ...strengths.map((item) => ({ ...item, kind: "strength", explanation: toSecondPerson(item.explanation) })),
  ].slice(0, mainPointLimits.technical);

  const priorities = (Array.isArray(analysis?.priorities) ? analysis.priorities : []).filter((item) => usableEvidence(item) && usableText(item.exercise)).slice(0, mainPointLimits.priorities)
    .map((item) => ({ ...item, focus: toSecondPerson(item.focus), exercise: toSecondPerson(item.exercise) }));

  return { english, technical, priorities, summary: toSecondPerson(technicalContent?.summary) };
}
