import test from "node:test";
import assert from "node:assert/strict";
import { findingsForAnswer, phonemeHint, summarizeDelivery } from "../src/lib/interview/report-response.mjs";

const item = { sequenceNumber: 2, evidence: "a", explanation: "b" };
const report = { turns: [], technicalContent: { strengths: [item], gaps: [] }, englishCommunication: { patterns: [] } };

test("per answer uses turn findings and falls back to legacy flat findings", () => {
  assert.deepEqual(findingsForAnswer(report, 2).strengths, [item]);
  report.turns = [{ sequenceNumber: 2, technicalStrengths: [], technicalGaps: [item], englishPatterns: [] }];
  assert.deepEqual(findingsForAnswer(report, 2).strengths, []);
  assert.deepEqual(findingsForAnswer(report, 2).gaps, [item]);
});

test("delivery stays descriptive and only adds a hint outside comfortable ranges", () => {
  assert.equal(summarizeDelivery({ wordsPerMinute: 128, pauseCount: 2, longestPauseMs: 900, fillerCount: 2 }).hint, null);
  assert.match(summarizeDelivery({ wordsPerMinute: 180, pauseCount: 4, longestPauseMs: 1200, fillerCount: 5 }).hint, /acelerado/u);
});

test("maps common Portuguese-speaker sounds", () => {
  assert.match(phonemeHint("θ"), /th/u);
  assert.equal(phonemeHint("unknown"), null);
});
