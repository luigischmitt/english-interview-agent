import test from "node:test";
import assert from "node:assert/strict";
import { findingsForAnswer, phonemeHint, summarizeDelivery } from "../src/lib/interview/report-response.mjs";

const item = { sequenceNumber: 2, evidence: "a", explanation: "Funciona." };
const report = { turns: [], technicalContent: { strengths: [item], gaps: [] }, englishCommunication: { patterns: [] } };

test("per answer uses turn findings and falls back to legacy flat findings", () => {
  assert.deepEqual(findingsForAnswer(report, 2).strengths, [item]);
  report.turns = [{ sequenceNumber: 2, technicalStrengths: [], technicalGaps: [item], englishPatterns: [] }];
  assert.deepEqual(findingsForAnswer(report, 2).strengths, []);
  assert.deepEqual(findingsForAnswer(report, 2).gaps, [item]);
});

test("per answer keeps a technical point only on the gap side when it conflicts", () => {
  const result = {
    turns: [{ sequenceNumber: 2, technicalStrengths: [{ sequenceNumber: 2, evidence: "we tested the options", explanation: "Você testou as opções antes de decidir." }], technicalGaps: [{ sequenceNumber: 2, evidence: "we tested the options", explanation: "Faltou explicar por que as opções foram escolhidas." }], englishPatterns: [] }],
    technicalContent: { strengths: [], gaps: [] }, englishCommunication: { patterns: [] },
  };
  const findings = findingsForAnswer(result, 2);
  assert.deepEqual(findings.strengths, []);
  assert.equal(findings.gaps.length, 1);
});

test("delivery stays descriptive and only adds a hint outside comfortable ranges", () => {
  assert.equal(summarizeDelivery({ wordsPerMinute: 128, pauseCount: 2, longestPauseMs: 900, fillerCount: 2 }).hint, null);
  assert.match(summarizeDelivery({ wordsPerMinute: 180, pauseCount: 4, longestPauseMs: 1200, fillerCount: 5 }).hint, /acelerado/u);
});

test("maps common Portuguese-speaker sounds", () => {
  assert.match(phonemeHint("θ"), /th/u);
  assert.equal(phonemeHint("unknown"), null);
});
