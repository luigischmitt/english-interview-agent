import test from "node:test";
import assert from "node:assert/strict";
import { buildPracticeWordList, buildVoiceEvolution, buildVoiceInsights, buildVoiceLesson, buildVoicePracticePlan, encodeWav16Mono, likelyTranscriptionArtifact, normalizePracticeSentenceCapitalization, readPracticeAttempts, savePracticeAttempt } from "../src/lib/interview/voice-insights.mjs";

const metric = (mean, totalDurationMs = 25_000) => ({ mean, sampleCount: 1, totalDurationMs });
const record = (id, completedAt, scores, answers = []) => ({ id, completedAt, createdAt: completedAt, feedback: { status: "ready", azureSummary: { accuracy: metric(scores.accuracy), fluency: metric(scores.fluency), prosody: metric(scores.prosody), answers } } });
const phrase = (phraseIndex, text, issue, problemWords = [], score = 70) => ({ phraseIndex, text, issue, problemWords, score });

test("uses only reliable values for comparisons and selects the lowest reliable focus", () => {
  const insights = buildVoiceInsights([
    record("latest", "2026-04-01", { accuracy: 85, fluency: 64, prosody: 58 }),
    record("previous", "2026-03-01", { accuracy: 80, fluency: 70, prosody: 60 }),
  ]);
  assert.equal(insights.focus, "prosody");
  assert.equal(insights.metrics.find((item) => item.key === "accuracy").previousAverage, 80);
  assert.equal(insights.metrics.find((item) => item.key === "prosody").level, "focus");
});

test("hides a value backed by too little audio and avoids a comparison", () => {
  const latest = record("latest", "2026-04-01", { accuracy: 62, fluency: 62, prosody: 62 });
  latest.feedback.azureSummary.accuracy = metric(62, 4_000);
  const insights = buildVoiceInsights([latest, record("previous", "2026-03-01", { accuracy: 80, fluency: 80, prosody: 80 })]);
  const accuracy = insights.metrics.find((item) => item.key === "accuracy");
  assert.equal(accuracy.value, null);
  assert.equal(accuracy.reliability, "insufficient");
  assert.equal(accuracy.previousAverage, null);
});

test("places phrase evidence in the correct metric and ranks the worst first", () => {
  const breakWord = { word: "service", score: 80, worstPhoneme: null, prosodyErrors: ["UnexpectedBreak"] };
  const accentWord = { word: "impact", score: 40, worstPhoneme: null, prosodyErrors: ["Monotone"] };
  const answer = { sequenceNumber: 3, delivery: { wordsPerMinute: 175, pauseCount: 5, longestPauseMs: 1_800, fillers: { um: 2, like: 1 } }, clips: [{ phraseIndex: 0, path: "clip.webm" }], phrases: [
    phrase(0, "I improved the service", "pronunciation", [breakWord], 60),
    phrase(1, "The impact was clear", "intonation", [accentWord], 40),
  ] };
  const insights = buildVoiceInsights([record("latest", "2026-04-01", { accuracy: 70, fluency: 65, prosody: 60 }, [answer])]);
  // Prosody is the focus (lowest), so it picks first; a phrase is never repeated in another section.
  assert.equal(insights.focus, "prosody");
  assert.deepEqual(insights.metrics.find((item) => item.key === "prosody").phrases.map((item) => item.text), ["The impact was clear", "I improved the service"]);
  assert.equal(insights.metrics.find((item) => item.key === "accuracy").phrases.length, 0);
  assert.equal(insights.metrics.find((item) => item.key === "fluency").phrases.length, 0);
  const rhythmFirst = buildVoiceInsights([record("latest", "2026-04-01", { accuracy: 70, fluency: 50, prosody: 60 }, [answer])]);
  assert.equal(rhythmFirst.metrics.find((item) => item.key === "fluency").phrases[0].text, "I improved the service");
  assert.deepEqual(rhythmFirst.metrics.find((item) => item.key === "prosody").phrases.map((item) => item.text), ["The impact was clear"]);
  assert.deepEqual(insights.metrics.find((item) => item.key === "fluency").tips.find((tip) => typeof tip !== "string")?.values, { fillers: "“um”, “like”" });
  assert.match(insights.metrics.find((item) => item.key === "fluency").tips.map((tip) => typeof tip === "string" ? tip : tip.key).join(" "), /velocidade|pausa|fillers/u);
});

test("keeps the empty state honest when no voice data exists", () => {
  const insights = buildVoiceInsights([{ id: "empty", completedAt: "2026-04-01", createdAt: "2026-04-01", feedback: null }]);
  assert.equal(insights.hasVoiceData, false);
  assert.equal(insights.focus, null);
});

test("builds lessons with only evidence-backed personal guidance", () => {
  const answer = { sequenceNumber: 1, delivery: { wordsPerMinute: 180, fillers: { um: 2 } }, phrases: [
    phrase(0, "I worked with this team", "pronunciation", [{ word: "worked", score: 40, worstPhoneme: "t", prosodyErrors: [] }]),
    phrase(1, "The result was reliable", "intonation", [{ word: "reliable", score: 50, worstPhoneme: null, prosodyErrors: ["Monotone"] }]),
  ] };
  const data = [record("latest", "2026-04-01", { accuracy: 60, fluency: 55, prosody: 50 }, [answer])];
  const accuracy = buildVoiceLesson(data, "accuracy");
  assert.equal(accuracy.example.text, "I worked with the team.");
  assert.deepEqual(accuracy.personalized[0], { key: "Na família {family}, seus exemplos são {words}.", values: { family: "Final -ed (worked, used)", words: "“worked”" } });
  assert.equal(buildVoiceLesson(data, "fluency").personalized.length, 2);
  assert.deepEqual(buildVoiceLesson(data, "prosody").personalized[0], { key: "Suas palavras com sinais de prosódia são {words}.", values: { words: "“reliable”" } });
  assert.equal(buildVoiceLesson([], "prosody").personalized.length, 0);
});

test("does not put generic coaching in personal guidance", () => {
  const data = [record("latest", "2026-04-01", { accuracy: 60, fluency: 55, prosody: 50 }, [{ sequenceNumber: 1, delivery: { wordsPerMinute: 180, pauseCount: 8 }, phrases: [
    phrase(0, "The result was clear", "intonation", [{ word: "clear", score: 50, prosodyErrors: ["Monotone"] }]),
    phrase(1, "The migration reduced costs", "intonation", []),
    phrase(2, "We shipped it safely", "pronunciation", [{ word: "shipped", score: 60, prosodyErrors: ["UnexpectedBreak"] }]),
  ] }])];
  assert.deepEqual(buildVoiceLesson(data, "fluency").personalized, [
    { key: "Seu ritmo recente foi de {wpm} palavras por minuto nas respostas avaliadas.", values: { wpm: "180" } },
  ]);
  const prosodyPersonalized = buildVoiceLesson(data, "prosody").personalized;
  assert.deepEqual(prosodyPersonalized, [
    { key: "Suas palavras com sinais de prosódia são {words}.", values: { words: "“clear”, “shipped”" } },
    { key: "Em {count} frases suas a entonação ficou plana.", values: { count: 2 } },
  ]);
  assert.equal(prosodyPersonalized.some((tip) => typeof tip === "string"), false);
  assert.equal(buildVoiceLesson([], "accuracy").personalized.length, 0);
});

test("creates a stable daily practice plan from corrected report sentences before complete saved answers", () => {
  const item = record("latest", "2026-04-01", { accuracy: 50, fluency: 75, prosody: 80 }, [{ sequenceNumber: 2, phrases: [phrase(0, "pause fragment", "pronunciation", [{ word: "architecture", score: 45, prosodyErrors: [] }])] }]);
  item.candidateAnswers = [{ sequenceNumber: 2, content: "Um I led the architecture migration for a highly available platform. I reduced deployment time without affecting customer traffic." }];
  item.feedback.analysis = { englishCommunication: { patterns: [
    { sequenceNumber: 2, rephrasedExample: "I led the architecture migration for a highly available platform." },
    { sequenceNumber: 2, rephrasedExample: "We delivered stable releases without affecting customer traffic." },
  ] } };
  const first = buildVoicePracticePlan([item], { now: new Date("2026-04-02T12:00:00Z") });
  const second = buildVoicePracticePlan([item], { now: new Date("2026-04-02T20:00:00Z") });
  assert.deepEqual(first.sentences, second.sentences);
  assert.equal(first.sentences[0].source, "report");
  assert.deepEqual(first.sentences.slice(0, 2).map((sentence) => sentence.text), ["I led the architecture migration for a highly available platform.", "We delivered stable releases without affecting customer traffic."]);
  assert.equal(first.sentences[2].source, "answer");
  assert.equal(likelyTranscriptionArtifact("um I led the platform"), true);
  assert.equal(likelyTranscriptionArtifact("I built a service service for customers."), true);
});

test("groups useful low-scored words and keeps only reliable evolution values", () => {
  const old = record("old", "2026-01-01", { accuracy: 60, fluency: 70, prosody: 80 }, [{ sequenceNumber: 1, phrases: [phrase(0, "ignored", "pronunciation", [{ word: "Database", score: 40, prosodyErrors: [] }, { word: "API", score: 30, prosodyErrors: [] }])] }]);
  const recent = record("recent", "2026-02-01", { accuracy: 80, fluency: 50, prosody: 70 }, [{ sequenceNumber: 1, phrases: [phrase(0, "ignored", "pronunciation", [{ word: "database", score: 60, prosodyErrors: [] }, { word: "go", score: 20, prosodyErrors: [] }])] }]);
  assert.deepEqual(buildPracticeWordList([old, recent]).map((word) => word.word), ["database"]);
  const evolution = buildVoiceEvolution([recent, old]);
  assert.deepEqual(evolution.accuracy.map((point) => point.value), [60, 80]);
});

test("only keeps repeated, substantial work words and uses them for sentence attention", () => {
  const old = record("old", "2026-01-01", { accuracy: 60, fluency: 70, prosody: 80 }, [{ sequenceNumber: 1, phrases: [phrase(0, "I will build a tree", "pronunciation", [
    { word: "will", score: 20, prosodyErrors: [] }, { word: "tree", score: 20, prosodyErrors: [] }, { word: "database", score: 65, prosodyErrors: [] }, { word: "API", score: 20, prosodyErrors: [] },
  ])] }]);
  const recent = record("recent", "2026-02-01", { accuracy: 50, fluency: 70, prosody: 80 }, [{ sequenceNumber: 1, phrases: [phrase(0, "I maintain a database", "pronunciation", [{ word: "database", score: 45, prosodyErrors: [] }])] }]);
  recent.candidateAnswers = [{ sequenceNumber: 1, content: "I am building a Machine learning model with a database." }];
  const words = buildPracticeWordList([old, recent]);
  assert.deepEqual(words.map((word) => word.word), ["database"]);
  const plan = buildVoicePracticePlan([old, recent], { now: new Date("2026-04-02T12:00:00Z") });
  assert.equal(plan.sentences[0].text, "I am building a machine learning model with a database.");
  assert.deepEqual(plan.sentences[0].attentionWords, ["database"]);
});

test("normalizes mid-sentence capitalization while preserving I, products, and acronyms", () => {
  assert.equal(normalizePracticeSentenceCapitalization("I am building a Machine learning model with Python, React, Gemini, WhatsApp, Meta and UFPB."), "I am building a machine learning model with Python, React, Gemini, WhatsApp, Meta and UFPB.");
  assert.equal(normalizePracticeSentenceCapitalization("The interviewer asked what I do. I'm building systems, I've led teams, I'd improve reliability, and I'll share the results."), "The interviewer asked what I do. I'm building systems, I've led teams, I'd improve reliability, and I'll share the results.");
  assert.equal(normalizePracticeSentenceCapitalization("I’m building a scalable platform for our customers."), "I’m building a scalable platform for our customers.");
});

test("encodes a browser-ready 16-bit mono WAV and bounds local attempts", () => {
  const wav = new DataView(encodeWav16Mono(new Float32Array([0, 1, -1])));
  assert.equal(wav.getUint32(24, true), 16_000);
  assert.equal(wav.getUint16(22, true), 1);
  assert.equal(wav.getUint16(34, true), 16);
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const attempt = { scores: { accuracy: 80, fluency: 70, prosody: 60 }, words: [], createdAt: "2026-04-01" };
  for (let index = 0; index < 8; index += 1) savePracticeAttempt(storage, "sentence", { ...attempt, createdAt: `2026-04-0${index + 1}` });
  assert.equal(readPracticeAttempts(storage).sentence.length, 6);
});
