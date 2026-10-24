import { diffReportWords, isCompleteSentence } from "./report-presentation.mjs";

const pad = (value) => String(value).padStart(2, "0");
const localDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const normalizeKey = (value) => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/gu, " ").trim();
const comparable = (value) => String(value ?? "").toLowerCase().replace(/\s+/gu, " ").trim().replace(/[.!?…]+$/u, "").trim();

/** "relatorio-senior-software-engineer-2026-10-24" from the target role and the local date. */
export function reportFileBase(role, date = new Date()) {
  const slug = normalizeKey(role).replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 60).replace(/-+$/u, "");
  return slug ? `relatorio-${slug}-${localDay(date)}` : `relatorio-entrevista-${localDay(date)}`;
}

const monthsPt = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
const monthsEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u;

function toValidDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && dateOnly.test(value)) {
    const [, year, month, day] = value.match(dateOnly).map(Number);
    const date = new Date(year, month - 1, day);
    return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Short document date: "24 out. 2026" (pt-BR) or "Oct 24, 2026" (en). */
export function formatReportDate(value, locale = "pt-BR", fallback = new Date()) {
  const date = toValidDate(value) ?? toValidDate(fallback) ?? new Date();
  if (String(locale).toLowerCase().startsWith("en")) return `${monthsEn[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  return `${date.getDate()} ${monthsPt[date.getMonth()]} ${date.getFullYear()}`;
}

/** Summary paragraph: the technical summary, then the English overview when it adds new text. */
export function reportSummaryText(result) {
  const summary = result?.technicalContent?.summary;
  const english = result?.overview?.english;
  const summaryText = isCompleteSentence(summary) ? summary.trim() : null;
  const englishText = isCompleteSentence(english) && !summaryText?.includes(english.trim()) ? english.trim() : null;
  return [summaryText, englishText].filter(Boolean).join(" ");
}

const maxCoverageItems = 6;

function competencyMatches(left, right) {
  const first = normalizeKey(left);
  const second = normalizeKey(right);
  if (!first || !second) return false;
  if (first === second) return true;
  return Math.min(first.length, second.length) >= 4 && (first.includes(second) || second.includes(first));
}

/** Shows which priority competencies the answers covered as strengths, gaps, or not at all. */
export function buildJobCoverage(competencies, strengths = [], gaps = []) {
  const seen = new Set();
  const items = [];
  for (const raw of Array.isArray(competencies) ? competencies : []) {
    if (items.length >= maxCoverageItems) break;
    const competency = typeof raw === "string" ? raw.trim() : "";
    const key = normalizeKey(competency);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const matches = (item) => competencyMatches(item?.vacancyCompetency, competency);
    const status = (Array.isArray(strengths) ? strengths : []).some(matches) ? "shown"
      : (Array.isArray(gaps) ? gaps : []).some(matches) ? "partial" : "missing";
    items.push({ competency, status });
  }
  return items;
}

/** Rows for "Seus erros": what the candidate said next to the corrected English. */
export function buildErrorRows(patterns = []) {
  const seen = new Set();
  const rows = [];
  for (const pattern of Array.isArray(patterns) ? patterns : []) {
    const evidence = text(pattern?.evidence);
    const rephrased = text(pattern?.rephrasedExample);
    if (!evidence || !rephrased || comparable(evidence) === comparable(rephrased)) continue;
    const key = comparable(evidence);
    if (seen.has(key)) continue;
    seen.add(key);
    const diff = diffReportWords(evidence, rephrased);
    const note = isCompleteSentence(pattern.why) ? pattern.why.trim()
      : isCompleteSentence(pattern.suggestion) ? pattern.suggestion.trim() : null;
    rows.push({ type: pattern.type, sequenceNumber: pattern.sequenceNumber, said: diff.original, right: diff.revised, note });
  }
  return rows;
}

const voiceDimensions = [
  { key: "accuracy", label: "Precisão", measure: "Clareza de cada som" },
  { key: "fluency", label: "Ritmo", measure: "Pausas e velocidade" },
  { key: "prosody", label: "Prosódia", measure: "Entonação e acento" },
];

/** Three voice notes in fixed order; value is null when the assessment has no usable samples. */
export function buildVoiceNotes(summary) {
  return voiceDimensions.map((dimension) => {
    const metric = summary?.[dimension.key];
    const usable = Boolean(metric && metric.sampleCount > 0 && Number.isFinite(metric.mean));
    return { ...dimension, value: usable ? Math.min(100, Math.max(0, Math.round(metric.mean))) : null };
  });
}

const maxPriorities = 3;
const englishTypeLabels = new Map([
  ["GRAMMAR", "Gramática"],
  ["WORD_CHOICE", "Escolha de palavras"],
  ["FALSE_COGNATE", "Falsos cognatos"],
  ["STRUCTURE", "Estrutura"],
]);

/** Up to three practice priorities: the report's own focuses, else the most frequent English error types. */
export function buildPracticePriorities(result) {
  const focused = (Array.isArray(result?.priorities) ? result.priorities : [])
    .filter((item) => typeof item?.focus === "string" && item.focus.trim());
  if (focused.length) {
    return focused.slice(0, maxPriorities).map((item) => ({
      title: item.focus.trim(),
      area: item.area === "TECHNICAL_CONTENT" ? "technical" : "english",
      sequenceNumber: Number.isSafeInteger(item.sequenceNumber) ? item.sequenceNumber : null,
      count: null,
    }));
  }
  const patterns = [
    ...(Array.isArray(result?.englishCommunication?.patterns) ? result.englishCommunication.patterns : []),
    ...(Array.isArray(result?.turns) ? result.turns : []).flatMap((turn) => Array.isArray(turn?.englishPatterns) ? turn.englishPatterns : []),
  ];
  const counts = new Map();
  const seen = new Set();
  for (const pattern of patterns) {
    const type = pattern?.type;
    if (!englishTypeLabels.has(type)) continue;
    const evidence = comparable(pattern.evidence);
    if (evidence) {
      const key = `${type}\n${evidence}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts]
    .sort((first, second) => second[1] - first[1])
    .slice(0, maxPriorities)
    .map(([type, count]) => ({ title: englishTypeLabels.get(type), area: "english", sequenceNumber: null, count }));
}
