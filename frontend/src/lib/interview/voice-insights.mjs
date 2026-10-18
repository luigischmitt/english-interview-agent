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
export const voiceScoreLevel = (value) => value === null ? "unavailable" : value >= 80 ? "good" : value >= 60 ? "attention" : "focus";
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
      level: voiceScoreLevel(current.value),
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

const practiceStorageKey = "eia:voice-practice:v1";
const lowWordScore = 70;
const fillerWords = new Set(["um", "uh", "er", "ah", "hmm", "like"]);
const practiceStopWords = new Set([
  "a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "our", "their",
  "i", "you", "he", "she", "we", "they", "it", "me", "him", "them", "us", "who", "which", "what",
  "am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "will", "would", "can", "could", "may", "might", "must", "should", "to", "of", "in", "on", "at", "by",
  "for", "from", "with", "without", "into", "onto", "over", "under", "about", "between", "through", "during",
  "before", "after", "and", "or", "but", "so", "because", "if", "than", "then", "as", "not", "very", "just",
]);
const sentenceProperNouns = new Set(["Python", "React", "Gemini", "WhatsApp", "Meta"]);

function normalizedWords(text) {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).map((word) => word.toLocaleLowerCase());
}

/** Conservative screen for transcript noise. A candidate sentence is only usable when it reads as a complete, clean line. */
export function likelyTranscriptionArtifact(text) {
  if (!isText(text) || /(?:\.\.\.|\u2026|\[[^\]]+\]|\([^)]*(?:inaudible|unclear)[^)]*\))/iu.test(text)) return true;
  const words = normalizedWords(text);
  if (words.some((word) => fillerWords.has(word))) return true;
  return words.some((word, index) => index > 0 && word === words[index - 1]);
}

function cleanPracticeSentence(text) {
  const value = typeof text === "string" ? text.replace(/\s+/gu, " ").trim() : "";
  const words = normalizedWords(value);
  if (words.length < 6 || words.length > 22 || likelyTranscriptionArtifact(value)) return null;
  if (!/^[\p{L}\p{N}\s.,!?;:'’"()\-–]+$/u.test(value)) return null;
  return normalizePracticeSentenceCapitalization(value);
}

/** Keeps the sentence natural for practice without flattening known products or acronyms. */
export function normalizePracticeSentenceCapitalization(text) {
  const value = typeof text === "string" ? text.replace(/\s+/gu, " ").trim() : "";
  let wordIndex = 0;
  return value.replace(/[\p{L}][\p{L}'’-]*/gu, (word) => {
    const isFirstWord = wordIndex++ === 0;
    const isAcronym = word.length > 1 && word === word.toLocaleUpperCase("en-US");
    if (isFirstWord || word === "I" || /^I['’](?:m|ve|d|ll)$/iu.test(word) || isAcronym || sentenceProperNouns.has(word)) return word;
    return /^[A-Z]/u.test(word) ? word.toLocaleLowerCase("en-US") : word;
  });
}

function lowWordsFor(records, focus) {
  const values = [];
  for (const record of records) {
    for (const answer of record?.feedback?.azureSummary?.answers ?? []) {
      for (const phrase of answer?.phrases ?? []) {
        if (focus && !belongsToMetric({ ...phrase, problemWords: phrase?.problemWords ?? [] }, focus)) continue;
        for (const word of phrase?.problemWords ?? []) {
          if (!isText(word?.word) || !isScore(word?.score) || word.score >= lowWordScore) continue;
          values.push({ word: word.word.trim(), score: word.score, time: timeOf(record), interviewId: record.id, sequenceNumber: answer.sequenceNumber });
        }
      }
    }
  }
  return values;
}

function isWorkWord(word) {
  const value = word.trim();
  const lower = value.toLocaleLowerCase("en-US");
  const letters = value.replace(/['’-]/gu, "");
  const isAcronym = value.length > 1 && value === value.toLocaleUpperCase("en-US");
  return letters.length >= 5 && /^[A-Za-z][A-Za-z'’-]*$/u.test(value) && !isAcronym && !practiceStopWords.has(lower);
}

/** Low Azure-scored content words, grouped so one repeated word has one practical training target. */
export function buildPracticeWordList(input) {
  const records = (Array.isArray(input) ? input : []).slice().sort((first, second) => timeOf(second) - timeOf(first));
  const grouped = new Map();
  for (const item of lowWordsFor(records)) {
    if (!isWorkWord(item.word)) continue;
    const key = item.word.toLocaleLowerCase();
    const current = grouped.get(key) ?? { word: item.word, total: 0, count: 0, worst: 100, time: 0, interviews: new Set() };
    current.total += item.score;
    current.count += 1;
    current.worst = Math.min(current.worst, item.score);
    current.time = Math.max(current.time, item.time);
    current.interviews.add(item.interviewId);
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .filter((item) => item.count >= 2 || item.interviews.size >= 2)
    .map((item) => ({ word: item.word, score: Math.round((item.total / item.count) * 10) / 10, count: item.count, worst: item.worst, time: item.time }))
    .sort((first, second) => second.count - first.count || first.worst - second.worst || first.score - second.score || second.time - first.time || first.word.localeCompare(second.word))
    .slice(0, 6);
}

function hash(value) {
  let result = 0;
  for (const character of value) result = ((result << 5) - result + character.charCodeAt(0)) | 0;
  return result >>> 0;
}

function dateKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function splitAnswerSentences(text) {
  return String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/gu) ?? [];
}

/** A stable daily queue: verified report rewrites first, then clean complete sentences from saved answers. */
export function buildVoicePracticePlan(input, { now = new Date() } = {}) {
  const records = (Array.isArray(input) ? input : []).slice().sort((first, second) => timeOf(second) - timeOf(first));
  const insights = buildVoiceInsights(records);
  const focusWords = new Set(buildPracticeWordList(records).map((item) => item.word.toLocaleLowerCase("en-US")));
  const candidates = [];
  for (const record of records) {
    const patterns = record?.feedback?.status === "ready" ? record.feedback?.analysis?.englishCommunication?.patterns : [];
    for (const pattern of Array.isArray(patterns) ? patterns : []) {
      const text = cleanPracticeSentence(pattern?.rephrasedExample);
      if (text) candidates.push({ id: `report:${record.id}:${pattern.sequenceNumber ?? 0}:${text.toLocaleLowerCase()}`, text, source: "report", time: timeOf(record) });
    }
  }
  for (const record of records) {
    const answerMap = new Map((record.candidateAnswers ?? []).map((answer) => [answer.sequenceNumber, answer.content]));
    for (const answer of record?.feedback?.azureSummary?.answers ?? []) {
      const hasLowWord = (answer?.phrases ?? []).some((phrase) => (phrase?.problemWords ?? []).some((word) => isScore(word?.score) && word.score < lowWordScore));
      if (!hasLowWord) continue;
      const fullAnswer = answerMap.get(answer.sequenceNumber);
      for (const part of splitAnswerSentences(fullAnswer)) {
        const text = cleanPracticeSentence(part);
        if (text) candidates.push({ id: `answer:${record.id}:${answer.sequenceNumber}:${text.toLocaleLowerCase()}`, text, source: "answer", time: timeOf(record) });
      }
    }
  }
  const seen = new Set();
  const day = dateKey(now);
  const items = candidates.filter((item) => {
    const key = item.text.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((item) => ({ ...item, attentionWords: normalizedWords(item.text).filter((word) => focusWords.has(word)) }))
    .sort((first, second) => Number(second.source === "report") - Number(first.source === "report") || Number(second.attentionWords.length > 0) - Number(first.attentionWords.length > 0) || second.time - first.time || hash(`${day}:${first.id}`) - hash(`${day}:${second.id}`));
  return { focus: insights.focus, sentences: items.slice(0, 5), words: buildPracticeWordList(records), evolution: buildVoiceEvolution(records), day };
}

/** Reliable interview metrics only, ordered chronologically for a compact history row. */
export function buildVoiceEvolution(input) {
  const records = (Array.isArray(input) ? input : []).slice().sort((first, second) => timeOf(first) - timeOf(second)).slice(-6);
  return Object.fromEntries(voiceMetrics.map((key) => [key, records.map((record) => {
    const metric = metricOf(record, key);
    return { id: record.id, date: dateOf(record), value: reliable(metric.reliability) ? metric.value : null };
  }).filter((point) => point.value !== null)]));
}

export function encodeWav16Mono(samples, sampleRate = 16_000) {
  const pcm = samples instanceof Float32Array ? samples : new Float32Array(samples ?? []);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const write = (offset, value) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
  write(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, pcm.length * 2, true);
  for (let index = 0; index < pcm.length; index += 1) view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, pcm[index])) * 0x7fff, true);
  return buffer;
}

export function readPracticeAttempts(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(practiceStorageKey) ?? "{}");
    return parsed && parsed.version === 1 && parsed.items && typeof parsed.items === "object" ? parsed.items : {};
  } catch { return {}; }
}

export function savePracticeAttempt(storage, sentenceId, attempt) {
  const items = readPracticeAttempts(storage);
  const history = Array.isArray(items[sentenceId]) ? items[sentenceId].slice(-3) : [];
  history.push(attempt);
  const bounded = Object.fromEntries(Object.entries({ ...items, [sentenceId]: history }).slice(-30));
  try { storage?.setItem?.(practiceStorageKey, JSON.stringify({ version: 1, items: bounded })); } catch { /* Local progress is optional. */ }
  return bounded;
}
