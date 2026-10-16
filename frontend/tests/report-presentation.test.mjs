import test from "node:test";
import assert from "node:assert/strict";
import { buildReportDeltas, diffReportWords, phonemeTip } from "../src/lib/interview/report-presentation.mjs";

test("word diff marks only changed words and preserves shared words", () => {
  assert.deepEqual(diffReportWords("I made a test.", "We ran a test."), {
    original: [{ text: "I", changed: true }, { text: " ", changed: false }, { text: "made", changed: true }, { text: " ", changed: false }, { text: "a", changed: false }, { text: " ", changed: false }, { text: "test", changed: false }, { text: ".", changed: false }],
    revised: [{ text: "We", changed: true }, { text: " ", changed: false }, { text: "ran", changed: true }, { text: " ", changed: false }, { text: "a", changed: false }, { text: " ", changed: false }, { text: "test", changed: false }, { text: ".", changed: false }],
  });
});

test("phoneme tips cover Azure symbols and use a safe fallback", () => {
  assert.match(phonemeTip("θ"), /língua entre os dentes/u);
  assert.match(phonemeTip("iy"), /i mais longo/u);
  assert.match(phonemeTip(undefined, "worked"), /-ed/u);
  assert.equal(phonemeTip("unknown"), "pronuncie cada sílaba com clareza");
});

test("report deltas compare only the latest previous completed ready report", () => {
  const records = [
    { id: "current", status: "completed", feedback: { status: "ready", analysis: {} } },
    { id: "older", status: "completed", completedAt: "2026-01-01", answerCount: 2, feedback: { status: "ready", analysis: { englishCommunication: { patterns: [{}, {}] }, technicalContent: { gaps: [{}] } }, azureSummary: { accuracy: { mean: 70 }, answers: [{ delivery: { wordsPerMinute: 110 } }] } } },
    { id: "newest", status: "completed", completedAt: "2026-02-01", answerCount: 2, feedback: { status: "ready", analysis: { englishCommunication: { patterns: [{}] }, technicalContent: { gaps: [{}] } }, azureSummary: { accuracy: { mean: 80 }, answers: [{ delivery: { wordsPerMinute: 125 } }] } } },
  ];
  const deltas = buildReportDeltas({ englishCommunication: { patterns: [{}, {}] }, technicalContent: { gaps: [{}, {}, {}] } }, { accuracy: { mean: 82 }, answers: [{ delivery: { wordsPerMinute: 130 } }] }, records, "current", 2);
  assert.equal(deltas[0].before, "0,5");
  assert.equal(deltas[0].after, "1,0");
  assert.equal(deltas[0].change, "worse");
  assert.equal(deltas.length, 3);
  assert.deepEqual(buildReportDeltas({}, {}, [], undefined, 1), []);
});
