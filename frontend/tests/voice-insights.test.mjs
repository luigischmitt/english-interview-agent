import test from "node:test";
import assert from "node:assert/strict";
import { buildVoiceInsights, buildVoiceTrainingPhrases, encodeWav16Mono, migrateLegacyPracticeAttempts, readPracticeAttempts, savePracticeAttempt } from "../src/lib/interview/voice-insights.mjs";

const metric = (mean, totalDurationMs = 25_000) => ({ mean, sampleCount: 1, totalDurationMs });
const record = (id, completedAt, answers = [], patterns = []) => ({
  id, completedAt, createdAt: completedAt,
  feedback: { status: "ready", azureSummary: { accuracy: metric(82), fluency: metric(76), prosody: metric(80), answers }, analysis: { englishCommunication: { patterns } } },
});
const voicePhrase = (text, phraseIndex = 0) => ({ phraseIndex, text, issue: "pronunciation", problemWords: [{ word: "latency", errorType: "Mispronunciation", prosodyErrors: [] }] });
const answer = (sequenceNumber, phrase) => ({ sequenceNumber, phrases: [phrase] });

test("automatically prioritizes the lowest reliable voice metric", () => {
  const insights = buildVoiceInsights([record("one", "2026-04-01", [])]);
  assert.equal(insights.focus, "fluency");
});

test("builds one source-specific entry per interview occurrence and ranks recurrence before recency", () => {
  const correction = { evidence: "I leaded the migration for our global customers.", rephrasedExample: "I led the migration for our global customers.", sequenceNumber: 4 };
  const older = record("interview-old", "2026-07-01", [answer(4, voicePhrase("We improved latency for our global customers."))], [correction]);
  const recent = record("interview-new", "2026-09-01", [answer(8, voicePhrase("I led the migration for our global customers."))], [correction]);
  const phrases = buildVoiceTrainingPhrases([recent, older]);
  const identical = phrases.filter((phrase) => phrase.normalizedTarget === "i led the migration for our global customers." && phrase.sourceKind === "english_correction");
  assert.equal(identical.length, 2, "identical text from separate interviews stays tied to each origin");
  assert.deepEqual(identical.map(({ interviewId, candidateSequenceNumber, sourceKind, phraseIndex }) => [interviewId, candidateSequenceNumber, sourceKind, phraseIndex]), [
    ["interview-new", 5, "english_correction", null],
    ["interview-old", 5, "english_correction", null],
  ]);
  assert.equal(phrases[0].recurrence, 3);
  assert.ok(phrases[0].id !== phrases[1].id);
});

test("uses voice flags only in their original phrase and sequence context", () => {
  const item = record("interview", "2026-09-01", [answer(6, voicePhrase("We improved latency for our global customers.", 2))]);
  const [phrase] = buildVoiceTrainingPhrases([item]);
  assert.equal(phrase.interviewId, "interview");
  assert.equal(phrase.candidateSequenceNumber, 7, "report sequence points to the interviewer turn; the candidate response is the next turn");
  assert.equal(phrase.phraseIndex, 2);
  assert.deepEqual(phrase.attentionWords, ["latency"]);
});

test("migrates legacy local attempts to one matching occurrence without merging interview origins", () => {
  const values = new Map([["eia:voice-practice:v1", JSON.stringify({ version: 1, items: {
    "training:i led the migration for our global customers.": [{ createdAt: "2026-04-01T12:00:00.000Z", scores: { accuracy: 80, fluency: 70, prosody: 60 }, words: [] }],
    "training:phrase no longer available in reports.": [{ createdAt: "2026-04-02T12:00:00.000Z", scores: {}, words: [] }],
  } })]]);
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const sources = buildVoiceTrainingPhrases([
    record("first", "2026-03-01", [], [{ sequenceNumber: 2, evidence: "I leaded the migration for our global customers.", rephrasedExample: "I led the migration for our global customers." }]),
    record("second", "2026-04-01", [], [{ sequenceNumber: 4, evidence: "I leaded the migration for our global customers.", rephrasedExample: "I led the migration for our global customers." }]),
  ]);
  const migrated = migrateLegacyPracticeAttempts(storage, sources);
  const withAttempts = Object.entries(migrated).filter(([, attempts]) => attempts.length);
  assert.equal(withAttempts.length, 1);
  assert.equal(withAttempts[0][0], sources.find((source) => source.interviewId === "second").id);
  assert.equal(withAttempts[0][1][0].migratedByText, true);
  assert.equal(JSON.parse(values.get("eia:voice-practice:v1")).items["training:phrase no longer available in reports."].length, 1);
});

test("stores bounded local attempt history and encodes mono 16-bit WAV", () => {
  const wav = new DataView(encodeWav16Mono(new Float32Array([0, 1, -1])));
  assert.equal(wav.getUint32(24, true), 16_000);
  assert.equal(wav.getUint16(22, true), 1);
  assert.equal(wav.getUint16(34, true), 16);
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const attempt = { id: "attempt", scores: { accuracy: 80, fluency: 70, prosody: 60 }, words: [], createdAt: "2026-04-01" };
  for (let index = 0; index < 8; index += 1) savePracticeAttempt(storage, "source", { ...attempt, createdAt: `2026-04-0${index + 1}` });
  assert.equal(readPracticeAttempts(storage).source.length, 6);
});
