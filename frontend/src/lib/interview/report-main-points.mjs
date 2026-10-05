/**
 * Main view of a saved report: a few English and technical points plus priorities.
 * Works for new (already capped) and legacy (up to 8 items per list) reports, so it
 * only reads fields that have always existed and caps again defensively.
 */
export const mainPointLimits = { english: 4, technical: 3, priorities: 3 };

const knownMishearing = /\b(?:super\s?base|versal|vercell|to hospital|run\s?shop|(?:they|we|you)['’]?re stained)\b/iu;
const trivialStrength = /\b(?:mencion(?:ou|ado|ar)|cit(?:ou|ado)|listou|nomeou|falou (?:sobre|de))\b|\b(?:trabalhou|participou|atuou) (?:em|de) (?:v[áa]rios|diversos|muitos) projetos?\b/iu;
const englishSentence = /\b(?:the candidate|did not|does not|their|clearly state)\b/iu;

/** Legacy text used "O candidato"; the report speaks to the user as "você". */
export function toSecondPerson(text) {
  return String(text ?? "").replace(/\b(?:[Oo]|[Aa]) (?:candidato|candidata|entrevistado|entrevistada)\b/gu, (match) => (match[0] === match[0].toUpperCase() ? "Você" : "você"));
}

function usableEvidence(item) {
  return typeof item?.evidence === "string" && !knownMishearing.test(item.evidence);
}

const words = (text) => String(text ?? "").toLowerCase().replace(/[’]/g, "'").match(/[a-z0-9]+/g) ?? [];

/** Legacy reports may carry a wrong rule label ("gerúndio" for a past-tense fix) or ask to fix a mis-heard name. */
function labelMatchesFix(pattern) {
  const suggestion = String(pattern.suggestion ?? "");
  if (/nomes?\s+(?:corret|real|certo|exat)|nomes?\s+d[eo]s?\s+(?:projet|produt)/iu.test(suggestion)) return false;
  const before = words(pattern.evidence);
  const after = words(pattern.rephrasedExample);
  const changed = [...before.filter((w) => !after.includes(w)), ...after.filter((w) => !before.includes(w))];
  if (/ger[úu]ndio/iu.test(suggestion) && !after.some((w) => w.endsWith("ing") && !before.includes(w))) return false;
  if (/concord[âa]ncia/iu.test(suggestion) && !changed.some((w) => /^(?:is|are|was|were|am|has|have|does|do|doesn|don)$/.test(w) || /s$/.test(w))) return false;
  return true;
}

function usableText(text) {
  return typeof text === "string" && text.trim().length > 0 && !englishSentence.test(text);
}

export function deriveMainPoints(analysis) {
  const patterns = Array.isArray(analysis?.englishCommunication?.patterns) ? analysis.englishCommunication.patterns : [];
  const seen = new Set();
  const english = [];
  for (const pattern of patterns) {
    if (!usableEvidence(pattern) || !usableText(pattern.suggestion) || !labelMatchesFix(pattern)) continue;
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
