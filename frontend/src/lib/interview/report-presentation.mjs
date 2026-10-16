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

/** Compare this ready report with the newest previous completed report. */
export function buildReportDeltas(current, currentAzure, records = [], currentInterviewId, currentAnswerCount = 0) {
  const previous = records.filter((record) => record.id !== currentInterviewId && record.status === "completed" && analysisOf(record))
    .sort((a, b) => Date.parse(b.completedAt ?? b.createdAt) - Date.parse(a.completedAt ?? a.createdAt))[0];
  if (!previous) return [];
  const before = analysisOf(previous);
  const countPatterns = (analysis) => analysis.turns?.reduce((sum, turn) => sum + (turn.englishPatterns?.length ?? 0), 0) ?? analysis.englishCommunication?.patterns?.length ?? 0;
  const countGaps = (analysis) => analysis.turns?.reduce((sum, turn) => sum + (turn.technicalGaps?.length ?? 0), 0) ?? analysis.technicalContent?.gaps?.length ?? 0;
  const currentAnswersCount = Math.max(1, currentAnswerCount);
  const previousAnswersCount = Math.max(1, previous.answerCount ?? 0);
  const deltas = [];
  const add = (label, oldValue, newValue, lowerIsBetter = true, digits = 1) => {
    if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) return;
    const change = Math.abs(oldValue - newValue) < 0.05 ? "same" : (newValue < oldValue) === lowerIsBetter ? "better" : "worse";
    deltas.push({ label, before: oldValue.toFixed(digits).replace(".", ","), after: newValue.toFixed(digits).replace(".", ","), change });
  };
  add("Erros de inglês por resposta", countPatterns(before) / previousAnswersCount, countPatterns(current) / currentAnswersCount);
  add("Lacunas técnicas por resposta", countGaps(before) / previousAnswersCount, countGaps(current) / currentAnswersCount);
  const oldWpm = average(answersOf(previous).map((answer) => metric(answer.delivery?.wordsPerMinute)).filter((value) => value !== null));
  const newWpm = average((currentAzure.answers ?? []).map((answer) => metric(answer.delivery?.wordsPerMinute)).filter((value) => value !== null));
  const oldAccuracy = previous.feedback?.azureSummary?.accuracy?.mean;
  const newAccuracy = currentAzure.accuracy?.mean;
  if (oldWpm !== null && newWpm !== null && Number.isFinite(oldAccuracy) && Number.isFinite(newAccuracy)) {
    const pacePart = (value) => `${Math.round(value)} wpm`;
    const accuracyPart = (value) => `${Math.round(value)}%`;
    deltas.push({ label: "Ritmo e precisão da pronúncia", before: `${pacePart(oldWpm)} · ${accuracyPart(oldAccuracy)}`, after: `${pacePart(newWpm)} · ${accuracyPart(newAccuracy)}`, change: Math.abs(newAccuracy - oldAccuracy) < 0.05 ? "same" : newAccuracy > oldAccuracy ? "better" : "worse" });
  } else if (oldWpm !== null && newWpm !== null) {
    add("Ritmo médio", oldWpm, newWpm, false, 0);
  } else if (Number.isFinite(oldAccuracy) && Number.isFinite(newAccuracy)) {
    add("Precisão do inglês", oldAccuracy, newAccuracy, false, 0);
  }
  return deltas.slice(0, 3);
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
