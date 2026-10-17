import { buildPronunciationInsights } from "./pronunciation-insights.mjs";
import { azureMetricReliability } from "./report-metrics.mjs";

export const voiceMetrics = ["accuracy", "fluency", "prosody"];

export const voiceMetricCopy = {
  accuracy: {
    label: "Precisão",
    measure: "Mostra o quão próximos os sons ficaram da pronúncia esperada.",
    heading: "Como melhorar sua precisão",
  },
  fluency: {
    label: "Ritmo",
    measure: "Mostra a fluidez entre palavras e pausas; não é velocidade de fala.",
    heading: "Como melhorar seu ritmo",
  },
  prosody: {
    label: "Prosódia",
    measure: "Mostra entonação e acento das palavras; não é uma nota de sotaque.",
    heading: "Como melhorar sua prosódia",
  },
};

const isText = (value) => typeof value === "string" && value.trim().length > 0;
const isScore = (value) => Number.isFinite(value) && value >= 0 && value <= 100;
const timeOf = (record) => {
  for (const value of [record?.completedAt, record?.startedAt, record?.createdAt]) {
    const time = value ? Date.parse(value) : Number.NaN;
    if (Number.isFinite(time)) return time;
  }
  return 0;
};
const dateOf = (record) => timeOf(record) ? new Date(timeOf(record)).toISOString() : null;
const levelFor = (value) => value === null ? "unavailable" : value >= 80 ? "good" : value >= 60 ? "attention" : "focus";
const reliable = (reliability) => reliability === "ok";

function metricOf(record, key) {
  const metric = record?.feedback?.azureSummary?.[key];
  const reliability = azureMetricReliability(metric);
  return {
    value: isScore(metric?.mean) ? metric.mean : null,
    reliability,
  };
}

function average(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function answerOrdinals(answers) {
  return new Map(answers
    .map((answer) => answer?.sequenceNumber)
    .filter(Number.isSafeInteger)
    .sort((a, b) => a - b)
    .map((sequenceNumber, index) => [sequenceNumber, index + 1]));
}

function phraseSeverity(phrase) {
  const scores = [phrase?.score, ...(phrase?.problemWords ?? []).map((word) => word?.score)].filter(isScore);
  return scores.length ? Math.min(...scores) : Number.POSITIVE_INFINITY;
}

function hasBreakError(phrase) {
  return phrase?.problemWords?.some((word) => word?.prosodyErrors?.some((error) => error === "UnexpectedBreak" || error === "MissingBreak"));
}

function belongsToMetric(phrase, metric) {
  if (metric === "accuracy") return phrase.issue === "pronunciation";
  if (metric === "prosody") return phrase.issue === "intonation" || phrase.problemWords.some((word) => word.prosodyErrors.length > 0);
  return hasBreakError(phrase);
}

function phrasesFor(records, metric) {
  const phrases = [];
  for (const record of records) {
    const answers = record?.feedback?.azureSummary?.answers;
    if (!Array.isArray(answers)) continue;
    const ordinals = answerOrdinals(answers);
    for (const answer of answers) {
      if (!Number.isSafeInteger(answer?.sequenceNumber) || !Array.isArray(answer?.phrases)) continue;
      for (const phrase of answer.phrases) {
        if (!isText(phrase?.text) || !Number.isSafeInteger(phrase?.phraseIndex)) continue;
        const problemWords = Array.isArray(phrase.problemWords)
          ? phrase.problemWords.filter((word) => isText(word?.word)).map((word) => ({ ...word, word: word.word.trim(), prosodyErrors: Array.isArray(word.prosodyErrors) ? word.prosodyErrors : [] }))
          : [];
        const normalized = {
          interviewId: record.id,
          date: dateOf(record),
          answerNumber: ordinals.get(answer.sequenceNumber) ?? 1,
          phraseIndex: phrase.phraseIndex,
          text: phrase.text.trim(),
          issue: phrase.issue === "intonation" ? "intonation" : "pronunciation",
          score: isScore(phrase.score) ? phrase.score : null,
          problemWords,
          clipPath: Array.isArray(answer.clips) ? answer.clips.find((clip) => clip?.phraseIndex === phrase.phraseIndex && isText(clip?.path))?.path ?? null : null,
          time: timeOf(record),
        };
        if (belongsToMetric(normalized, metric)) phrases.push(normalized);
      }
    }
  }
  return phrases.sort((first, second) => phraseSeverity(first) - phraseSeverity(second) || second.time - first.time || first.answerNumber - second.answerNumber || first.phraseIndex - second.phraseIndex);
}

function accuracyTips(records) {
  const families = buildPronunciationInsights(records).families.slice(0, 3);
  if (!families.length) return ["Ainda não há palavras destacadas para orientar o treino de precisão."];
  const examples = [...new Set(families.flatMap((family) => family.examples))].slice(0, 3);
  return [...families.slice(0, examples.length ? 2 : 3).map((family) => family.tip), ...(examples.length ? [{ key: "Palavras suas para praticar: {words}.", values: { words: examples.map((word) => `“${word}”`).join(", ") } }] : [])];
}

function latestDelivery(record) {
  const answers = record?.feedback?.azureSummary?.answers;
  if (!Array.isArray(answers)) return [];
  return answers.map((answer) => answer?.delivery).filter((delivery) => delivery && typeof delivery === "object");
}

function rhythmTips(record) {
  const delivery = latestDelivery(record);
  const wpm = average(delivery.map((entry) => entry.wordsPerMinute).filter(Number.isFinite));
  const longestPauseMs = Math.max(0, ...delivery.map((entry) => Number.isFinite(entry.longestPauseMs) ? entry.longestPauseMs : 0));
  const pauseCount = delivery.reduce((sum, entry) => sum + (Number.isFinite(entry.pauseCount) ? entry.pauseCount : 0), 0);
  // Saved as { filler: count } by backend/src/transcription/answer-voice-detail.ts.
  const fillers = [...new Set(delivery.flatMap((entry) => entry.fillers && typeof entry.fillers === "object" ? Object.keys(entry.fillers).filter((word) => isText(word) && entry.fillers[word] > 0).map((word) => word.trim()) : []))].slice(0, 3);
  const tips = [];
  if (wpm !== null && wpm > 165) tips.push("Diminua um pouco a velocidade: deixe uma breve pausa entre as ideias para cada palavra aparecer com clareza.");
  if (wpm !== null && wpm < 110) tips.push("Sustente a ideia por mais tempo: conecte duas frases curtas antes de fazer uma pausa.");
  if (longestPauseMs >= 1_500 || pauseCount >= 4) tips.push("Marque a pausa antes de uma ideia importante e retome com uma frase completa, em vez de interromper o meio da explicação.");
  if (fillers.length) tips.push({ key: "Troque {fillers} por uma pausa curta enquanto organiza a próxima ideia.", values: { fillers: fillers.map((word) => `“${word}”`).join(", ") } });
  return tips.slice(0, 3).length ? tips.slice(0, 3) : ["Ainda não há dados de ritmo suficientes para indicar um exercício específico."];
}

function prosodyTips(records) {
  const phrases = phrasesFor(records, "prosody");
  const words = [...new Set(phrases.flatMap((phrase) => phrase.problemWords.filter((word) => word.prosodyErrors.length).map((word) => word.word)))].slice(0, 3);
  const errors = phrases.flatMap((phrase) => phrase.problemWords.flatMap((word) => word.prosodyErrors));
  const tips = [];
  if (words.length) tips.push({ key: "Destaque a palavra principal da ideia, especialmente em {words}.", values: { words: words.map((word) => `“${word}”`).join(", ") } });
  if (errors.includes("Monotone") || phrases.some((phrase) => phrase.issue === "intonation")) tips.push("Suba ou desça levemente o tom na palavra que carrega o resultado, a decisão ou o contraste.");
  if (errors.some((error) => error === "UnexpectedBreak" || error === "MissingBreak")) tips.push("Divida frases longas em blocos de sentido e faça a pausa entre os blocos, não dentro deles.");
  return tips.slice(0, 3).length ? tips.slice(0, 3) : ["Ainda não há sinais de entonação suficientes para indicar um exercício específico."];
}

function tipsFor(metric, records, latest) {
  if (metric === "accuracy") return accuracyTips(records);
  if (metric === "fluency") return rhythmTips(latest);
  return prosodyTips(records);
}

/** Builds a cautious, persisted-data-only practice plan for the voice screen. */
export function buildVoiceInsights(input) {
  const records = (Array.isArray(input) ? input : []).slice().sort((first, second) => timeOf(second) - timeOf(first));
  const latest = records.find((record) => voiceMetrics.some((metric) => metricOf(record, metric).value !== null)) ?? null;
  const hasVoiceData = records.some((record) => {
    const answers = record?.feedback?.azureSummary?.answers;
    return voiceMetrics.some((metric) => metricOf(record, metric).value !== null) || (Array.isArray(answers) && answers.some((answer) => Array.isArray(answer?.phrases) && answer.phrases.some((phrase) => isText(phrase?.text))));
  });
  const metrics = voiceMetrics.map((key) => {
    const current = latest ? metricOf(latest, key) : { value: null, reliability: "none" };
    const previous = latest ? records.filter((record) => record.id !== latest.id).slice(0, 3) : [];
    const previousValues = previous.map((record) => metricOf(record, key)).filter((entry) => reliable(entry.reliability) && entry.value !== null).map((entry) => entry.value);
    const previousAverage = reliable(current.reliability) && previousValues.length ? average(previousValues) : null;
    return {
      key,
      ...voiceMetricCopy[key],
      value: current.reliability === "insufficient" ? null : current.value,
      rawValue: current.value,
      reliability: current.reliability,
      previousAverage,
      level: levelFor(current.value),
      tips: tipsFor(key, records, latest),
      phrases: phrasesFor(records, key),
    };
  });
  const focus = metrics.filter((metric) => reliable(metric.reliability) && metric.rawValue !== null).sort((first, second) => first.rawValue - second.rawValue)[0]?.key ?? null;
  // A phrase is practiced in one section only: the focus metric picks first, then the others in display order.
  const used = new Set();
  for (const key of [focus, ...voiceMetrics.filter((metric) => metric !== focus)]) {
    const metric = metrics.find((item) => item.key === key);
    if (!metric) continue;
    metric.phrases = metric.phrases.filter((phrase) => !used.has(`${phrase.interviewId}-${phrase.answerNumber}-${phrase.phraseIndex}`)).slice(0, 4);
    for (const phrase of metric.phrases) used.add(`${phrase.interviewId}-${phrase.answerNumber}-${phrase.phraseIndex}`);
  }
  return { hasVoiceData, latestDate: latest ? dateOf(latest) : null, focus, metrics };
}
