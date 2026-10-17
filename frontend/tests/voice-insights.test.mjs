import test from "node:test";
import assert from "node:assert/strict";
import { buildVoiceInsights } from "../src/lib/interview/voice-insights.mjs";

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
