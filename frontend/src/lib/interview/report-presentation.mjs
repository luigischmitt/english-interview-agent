const tokenize = (text) => text.match(/[\p{L}\p{N}’'-]+|[^\p{L}\p{N}’'-]+/gu) ?? [];

/** Word-level comparison that preserves punctuation and whitespace. */
export function diffReportWords(original, revised) {
  const left = tokenize(String(original ?? ""));
  const right = tokenize(String(revised ?? ""));
  const table = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) for (let j = right.length - 1; j >= 0; j -= 1) {
    table[i][j] = left[i].toLowerCase() === right[j].toLowerCase() ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const oldParts = [];
  const newParts = [];
  for (let i = 0, j = 0; i < left.length || j < right.length;) {
    if (i < left.length && j < right.length && left[i].toLowerCase() === right[j].toLowerCase()) {
      oldParts.push({ text: left[i], changed: false }); newParts.push({ text: right[j], changed: false }); i += 1; j += 1;
    } else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) {
      newParts.push({ text: right[j], changed: /[\p{L}\p{N}]/u.test(right[j]) }); j += 1;
    } else {
      oldParts.push({ text: left[i], changed: /[\p{L}\p{N}]/u.test(left[i]) }); i += 1;
    }
  }
  return { original: oldParts, revised: newParts };
}

const metric = (value) => Number.isFinite(value) ? value : null;
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const analysisOf = (record) => record?.feedback?.status === "ready" && record.feedback.analysis && typeof record.feedback.analysis === "object" ? record.feedback.analysis : null;
const answersOf = (record) => record?.feedback?.azureSummary?.answers ?? [];

/** A report explanation must look like a finished sentence before we show it. */
export function isCompleteSentence(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || /(?:\.{2,}|…|[—–,:;-])\s*["'”’)]*$/u.test(text)) return false;
  return /[^\s.!?][.!?]["'”’)]*$/u.test(text);
}

const normalizePoint = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/gu, " ").trim();

const pointTokens = (value) => normalizePoint(value).split(" ").filter((word) => word.length > 2)
  .map((word) => word.replace(/(?:ando|endo|indo|acao|coes|ou|ar|er|ir|ado|ada|ido|ida)$/u, ""));

function samePoint(first, second) {
  const left = new Set(pointTokens(first));
  const right = new Set(pointTokens(second));
  if (!left.size || !right.size) return normalizePoint(first) === normalizePoint(second);
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size) >= 0.7;
}

/** Keep gaps over matching strengths so the report never makes the same point in opposing columns. */
export function displayTechnicalFindings(strengths = [], gaps = [], otherNegativeFindings = []) {
  const visibleGaps = gaps.filter((item) => isCompleteSentence(item?.explanation));
  const negativeFindings = [...visibleGaps, ...otherNegativeFindings];
  return {
    strengths: strengths.filter((item) => isCompleteSentence(item?.explanation)
      && !negativeFindings.some((gap) => samePoint(item.explanation, gap?.explanation) || samePoint(item.evidence, gap?.evidence))),
    gaps: visibleGaps,
  };
}

export function displayInterviewerTakeaway(takeaway, otherNegativeFindings = []) {
  const concern = isCompleteSentence(takeaway?.concern) ? takeaway.concern.trim() : null;
  const negativeFindings = concern ? [{ explanation: concern }, ...otherNegativeFindings] : otherNegativeFindings;
  const remember = isCompleteSentence(takeaway?.remember) && !negativeFindings.some((item) => samePoint(takeaway.remember, item?.explanation)) ? takeaway.remember.trim() : null;
  return { remember, concern };
}

export function hasIncompleteAnalysisCoverage(report) {
  const coverage = report?.analysisCoverage;
  return Number.isFinite(coverage?.analyzedTurnCount) && Number.isFinite(coverage?.totalTurnCount)
    && coverage.totalTurnCount > 0 && coverage.analyzedTurnCount < coverage.totalTurnCount;
}

/** State exactly which answers are missing, without implying the report covers them. */
export function analysisCoverageNotice(coverage, ordinalForSequence = (sequenceNumber) => sequenceNumber) {
  if (!hasIncompleteAnalysisCoverage({ analysisCoverage: coverage })) return null;
  const missing = Array.isArray(coverage.missingSequenceNumbers) ? coverage.missingSequenceNumbers
    .filter((sequenceNumber) => Number.isSafeInteger(sequenceNumber))
    .map((sequenceNumber) => ordinalForSequence(sequenceNumber) ?? sequenceNumber) : [];
  if (missing.length === 1) return `Não conseguimos analisar a resposta ${missing[0]}. Os pontos abaixo cobrem as outras respostas.`;
  if (missing.length > 1) return `Não conseguimos analisar as respostas ${missing.join(" e ")}. Os pontos abaixo cobrem as outras respostas.`;
  return "Nem todas as respostas puderam ser analisadas. Os pontos abaixo cobrem as outras respostas.";
}

const rateCopy = (name, oldValue, newValue) => {
  const same = Math.abs(oldValue - newValue) < 0.05;
  const direction = same ? `${name} iguais` : newValue < oldValue ? `Menos ${name.toLocaleLowerCase()}` : `Mais ${name.toLocaleLowerCase()}`;
  return { label: same ? `${direction}: ${formatNumber(newValue)}` : `${direction}: ${formatNumber(oldValue)} → ${formatNumber(newValue)}`, before: formatNumber(oldValue), after: formatNumber(newValue), change: same ? "same" : newValue < oldValue ? "better" : "worse" };
};
const formatNumber = (value) => value.toFixed(1).replace(/\.0$/, "").replace(".", ",");

/** Compare this ready report with the newest previous completed report. */
export function buildReportDeltas(current, currentAzure, records = [], currentInterviewId, currentAnswerCount = 0) {
  const previous = records.filter((record) => record.id !== currentInterviewId && record.status === "completed" && analysisOf(record))
    .sort((a, b) => Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt))[0];
  if (!previous) return [];
  const before = analysisOf(previous);
  if (hasIncompleteAnalysisCoverage(current) || hasIncompleteAnalysisCoverage(before)) return [];
  const countPatterns = (analysis) => analysis.turns?.reduce((sum, turn) => sum + (turn.englishPatterns?.length ?? 0), 0) ?? analysis.englishCommunication?.patterns?.length ?? 0;
  const countGaps = (analysis) => analysis.turns?.reduce((sum, turn) => sum + (turn.technicalGaps?.length ?? 0), 0) ?? analysis.technicalContent?.gaps?.length ?? 0;
  const currentAnswersCount = Math.max(1, currentAnswerCount);
  const previousAnswersCount = Math.max(1, previous.answerCount ?? 0);
  const deltas = [];
  const addRate = (label, oldValue, newValue) => {
    if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) return;
    deltas.push(rateCopy(label, oldValue, newValue));
  };
  addRate("Erros de inglês por resposta", countPatterns(before) / previousAnswersCount, countPatterns(current) / currentAnswersCount);
  addRate("Lacunas técnicas por resposta", countGaps(before) / previousAnswersCount, countGaps(current) / currentAnswersCount);
  const oldWpm = average(answersOf(previous).map((answer) => metric(answer.delivery?.wordsPerMinute)).filter((value) => value !== null));
  const newWpm = average((currentAzure.answers ?? []).map((answer) => metric(answer.delivery?.wordsPerMinute)).filter((value) => value !== null));
  const oldAccuracy = previous.feedback?.azureSummary?.accuracy?.mean;
  const newAccuracy = currentAzure.accuracy?.mean;
  if (oldWpm !== null && newWpm !== null && Math.abs(newWpm - oldWpm) >= 5) {
    const direction = newWpm > oldWpm ? "Fala mais rápida" : "Fala mais pausada";
    deltas.push({ label: `${direction}: ${Math.round(oldWpm)} → ${Math.round(newWpm)} palavras por minuto`, before: String(Math.round(oldWpm)), after: String(Math.round(newWpm)), change: "same" });
  }
  if (Number.isFinite(oldAccuracy) && Number.isFinite(newAccuracy)) {
    const same = Math.abs(newAccuracy - oldAccuracy) < 1;
    const direction = same ? "Precisão da pronúncia igual" : newAccuracy > oldAccuracy ? "Precisão da pronúncia maior" : "Precisão da pronúncia menor";
    deltas.push({ label: same ? `${direction}: ${Math.round(newAccuracy)}%` : `${direction}: ${Math.round(oldAccuracy)}% → ${Math.round(newAccuracy)}%`, before: `${Math.round(oldAccuracy)}%`, after: `${Math.round(newAccuracy)}%`, change: same ? "same" : newAccuracy > oldAccuracy ? "better" : "worse" });
  }
  return deltas;
}

const phonemeTips = [
  [/^θ|\bth\b/i, "th: língua entre os dentes, com sopro."], [/^ð|\bdh\b/i, "th sonoro: língua entre os dentes e voz vibrando."],
  [/^ɹ|^r$/i, "r: leve a língua para trás, sem vibrar."], [/^h|^hh$/i, "h: solte um sopro leve no início."],
  [/^z$/i, "z: mantenha a voz vibrando durante o som."], [/^s$/i, "s: mantenha o ar passando sem voz."],
  [/^v$/i, "v: encoste os dentes de cima no lábio inferior."], [/^w$/i, "w: arredonde os lábios no começo."],
  [/^ɪ|^ih$/i, "ih: faça um i curto e relaxado."], [/^iː|^iy$/i, "iy: sustente um i mais longo."],
  [/^æ|^ae$/i, "ae: abra mais a boca para a vogal."], [/^ʌ|^ah$/i, "ah: use uma vogal curta e central."],
  [/^ə|^ax$/i, "ax: reduza a vogal para um som curto de â."], [/^uː|^uw$/i, "uw: arredonde os lábios e sustente o u."],
  [/^ʊ|^uh$/i, "uh: faça um u curto e relaxado."], [/^eɪ|^ey$/i, "ey: comece aberto e deslize para i."],
  [/^oʊ|^ow$/i, "ow: comece arredondado e deslize para u."], [/^ɝ|^er$/i, "er: mantenha a língua recolhida durante a vogal."],
  [/^ŋ|^ng$/i, "ng: termine pelo nariz, sem acrescentar g."], [/^l.*final|^l$/i, "l final: mantenha a língua tocando atrás dos dentes."],
  [/ed$/i, "-ed: pronuncie a terminação sem acrescentar outra sílaba quando ela não existir."],
];
export function phonemeTip(phoneme, word = "") {
  const value = String(phoneme ?? "");
  return phonemeTips.find(([pattern]) => pattern.test(value))?.[1]
    ?? (/ed$/i.test(word) ? phonemeTips.at(-1)[1] : "pronuncie cada sílaba com clareza");
}
