import test from "node:test";
import assert from "node:assert/strict";
import { buildRedoComparison, appendRedoAttempt } from "../src/lib/interview/redo-comparison.mjs";
import { serializeInterviewAnalysis } from "../src/lib/interview/study-plan.mjs";

test("redo comparison keeps delivery, pronunciation and every pattern within four calm lines", () => {
  const lines = buildRedoComparison(
    { delivery: { wordsPerMinute: 120, longestPauseMs: 2_100, fillerCount: 4 }, worstSentence: { score: 61 } },
    { delivery: { wordsPerMinute: 135, longestPauseMs: 900, fillerCount: 2 }, worstSentence: { score: 76 } },
    [{ evidence: "in the weekend", fixed: true }, { evidence: "more fast", fixed: false }],
  );
  assert.equal(lines.length, 4);
  assert.deepEqual(lines.map((line) => line.kind), ["pace", "delivery", "score", "patterns"]);
  assert.deepEqual(lines[3].patterns.map((pattern) => pattern.fixed), [true, false]);
  assert.match(lines[1].pauses, /2\.1s → 0\.9s/u);
});

test("redo comparison omits unavailable comparisons", () => {
  assert.deepEqual(buildRedoComparison({}, { delivery: { wordsPerMinute: 100 } }), []);
});

test("redo attempts retain only five newest and serializer allowlists fields without clips", () => {
  const attempts = appendRedoAttempt(Array.from({ length: 5 }, (_, index) => ({ transcript: String(index) })), { transcript: "new", createdAt: "today" });
  assert.equal(attempts.length, 5);
  assert.equal(attempts.at(-1).transcript, "new");
  const serialized = serializeInterviewAnalysis({
    turns: [], evidenceReview: {}, technicalContent: {}, englishCommunication: {}, priorities: [],
    redos: { "2": [{ createdAt: "today", transcript: "again", clip: "private", delivery: { wordsPerMinute: 110, clipBase64: "private" }, worstSentence: { sentenceIndex: 0, text: "line", score: 70, clip: { base64: "audio" } }, patternCheck: [{ evidence: "example", fixed: true, note: "ok" }] }] },
  });
  assert.deepEqual(serialized.redos["2"][0], { createdAt: "today", transcript: "again", delivery: { wordsPerMinute: 110 }, worstSentence: { sentenceIndex: 0, text: "line", score: 70 }, patternCheck: [{ evidence: "example", fixed: true, note: "ok" }] });
});
