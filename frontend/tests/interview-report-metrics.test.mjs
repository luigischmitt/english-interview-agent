import assert from "node:assert/strict";
import test from "node:test";
import { azureMetricReliability, insufficientAzureAudioMs, limitedAzureAudioMs, answerOrdinalForSequence, appendInterviewReportPair, pairInterviewTurns, summarizeAzureAssessments } from "../src/lib/interview/report-metrics.mjs";

test("Azure means ignore unavailable, pending, null, and invalid dimension values while counting valid samples", () => {
  const summary = summarizeAzureAssessments([
    { status: "available", scores: { accuracy: 80, fluency: null, prosody: 70 } },
    { status: "unavailable" },
    { status: "pending" },
    { status: "available", scores: { accuracy: 90, fluency: 60, prosody: 110 } },
  ]);
  assert.deepEqual(summary, {
    accuracy: { mean: 85, sampleCount: 2, totalDurationMs: null },
    fluency: { mean: 60, sampleCount: 1, totalDurationMs: null },
    prosody: { mean: 70, sampleCount: 1, totalDurationMs: null },
  });
});

test("Azure dimensions with no usable score have null means and zero samples", () => {
  assert.deepEqual(summarizeAzureAssessments([{ status: "unavailable" }, { status: "available", scores: { accuracy: null, fluency: null, prosody: null } }]), {
    accuracy: { mean: null, sampleCount: 0, totalDurationMs: null }, fluency: { mean: null, sampleCount: 0, totalDurationMs: null }, prosody: { mean: null, sampleCount: 0, totalDurationMs: null },
  });
});

test("weights Azure samples by response duration when provided", () => {
  const summary = summarizeAzureAssessments([
    { status: "available", durationMs: 1_000, scores: { accuracy: 50, fluency: 50, prosody: 50 } },
    { status: "available", durationMs: 3_000, scores: { accuracy: 90, fluency: 90, prosody: 90 } },
  ]);
  assert.deepEqual(summary, {
    accuracy: { mean: 80, sampleCount: 2, totalDurationMs: 4_000 },
    fluency: { mean: 80, sampleCount: 2, totalDurationMs: 4_000 },
    prosody: { mean: 80, sampleCount: 2, totalDurationMs: 4_000 },
  });
});

test("pairs ordered interviewer prompts and candidate answers without storing duplicate transcript data", () => {
  const turns = [
    { sequenceNumber: 4, speaker: "interviewer", content: "Follow-up?" },
    { sequenceNumber: 5, speaker: "candidate", content: " A follow-up answer. " },
    { sequenceNumber: 2, speaker: "interviewer", content: "Main question?" },
    { sequenceNumber: 3, speaker: "candidate", content: "Main answer." },
    { sequenceNumber: 6, speaker: "interviewer", content: "Unanswered question?" },
  ];
  assert.deepEqual(pairInterviewTurns(turns), [
    { sequenceNumber: 2, question: "Main question?", answer: "Main answer." },
    { sequenceNumber: 4, question: "Follow-up?", answer: "A follow-up answer." },
  ]);
});

test("the report snapshot includes the eighth answer immediately when submission closes the interview", () => {
  let latestTurns = [];
  for (let index = 0; index < 8; index += 1) {
    const questionSequenceNumber = index * 2 + 1;
    latestTurns = appendInterviewReportPair(latestTurns, {
      questionSequenceNumber,
      candidateSequenceNumber: questionSequenceNumber + 1,
      question: `Question ${index + 1}?`,
      answer: `Answer ${index + 1}.`,
    });
  }

  assert.equal(pairInterviewTurns(latestTurns).length, 8);
  assert.deepEqual(pairInterviewTurns(latestTurns).at(-1), {
    sequenceNumber: 15,
    question: "Question 8?",
    answer: "Answer 8.",
  });
});

test("maps internal turn sequences to the same visible answer ordinal used in the report", () => {
  const turns = [
    { sequenceNumber: 1, question: "First?", answer: "First answer." },
    { sequenceNumber: 3, question: "Second?", answer: "Second answer." },
    { sequenceNumber: 6, question: "Third?", answer: "Third answer." },
  ];
  assert.equal(answerOrdinalForSequence(turns, 1), 1);
  assert.equal(answerOrdinalForSequence(turns, 3), 2);
  assert.equal(answerOrdinalForSequence(turns, 6), 3);
  assert.equal(answerOrdinalForSequence(turns, 5), null);
});

const scoresOf = (value) => ({ accuracy: value, fluency: value, prosody: value });

test("session mean is weighted by assessed speech duration, so a long answer outweighs a short one (not a plain average of answers)", () => {
  const summary = summarizeAzureAssessments([
    { status: "available", durationMs: 30_000, scores: scoresOf(90) },
    { status: "available", durationMs: 2_000, scores: scoresOf(40) },
  ]);
  assert.equal(summary.accuracy.mean, 86.9); // (90*30000 + 40*2000) / 32000 = 86.875
  assert.equal(summary.accuracy.sampleCount, 2);
  assert.equal(summary.accuracy.totalDurationMs, 32_000);
});

test("a missing or zero duration falls back to equal weights instead of nearly erasing that answer", () => {
  const summary = summarizeAzureAssessments([
    { status: "available", durationMs: 20_000, scores: scoresOf(90) },
    { status: "available", durationMs: 0, scores: scoresOf(50) },
    { status: "available", scores: scoresOf(70) },
  ]);
  assert.equal(summary.fluency.mean, 70);
  assert.equal(summary.fluency.totalDurationMs, null);
});

test("each dimension is weighted only by the answers that have that dimension", () => {
  const summary = summarizeAzureAssessments([
    { status: "available", durationMs: 10_000, scores: { accuracy: 80, fluency: 80, prosody: null } },
    { status: "available", durationMs: 30_000, scores: { accuracy: 60, fluency: null, prosody: 90 } },
  ]);
  assert.equal(summary.accuracy.mean, 65);
  assert.deepEqual(summary.fluency, { mean: 80, sampleCount: 1, totalDurationMs: 10_000 });
  assert.deepEqual(summary.prosody, { mean: 90, sampleCount: 1, totalDurationMs: 30_000 });
});

test("empty input, only pending/unavailable answers and out-of-range scores never produce a number", () => {
  for (const input of [[], [{ status: "pending" }, { status: "unavailable" }], [{ status: "available", durationMs: 9_000, scores: scoresOf(-1) }], [{ status: "available", durationMs: 9_000, scores: scoresOf(Number.NaN) }]]) {
    assert.equal(summarizeAzureAssessments(input).accuracy.mean, null);
  }
  assert.equal(summarizeAzureAssessments([{ status: "available", durationMs: 9_000, scores: scoresOf(0) }]).accuracy.mean, 0);
});

test("a score of exactly 0 or 100 is valid and the mean is rounded to one decimal", () => {
  const summary = summarizeAzureAssessments([
    { status: "available", durationMs: 1_000, scores: scoresOf(100) },
    { status: "available", durationMs: 2_000, scores: scoresOf(0) },
  ]);
  assert.equal(summary.prosody.mean, 33.3);
});

test("reliability hides numbers backed by very little speech and marks short samples as limited", () => {
  assert.equal(azureMetricReliability(undefined), "none");
  assert.equal(azureMetricReliability({ mean: null, sampleCount: 0, totalDurationMs: null }), "none");
  assert.equal(azureMetricReliability({ mean: 80, sampleCount: 1, totalDurationMs: insufficientAzureAudioMs - 1 }), "insufficient");
  assert.equal(azureMetricReliability({ mean: 80, sampleCount: 1, totalDurationMs: insufficientAzureAudioMs }), "limited");
  assert.equal(azureMetricReliability({ mean: 80, sampleCount: 2, totalDurationMs: limitedAzureAudioMs - 1 }), "limited");
  assert.equal(azureMetricReliability({ mean: 80, sampleCount: 2, totalDurationMs: limitedAzureAudioMs }), "ok");
  // duration unknown (older saved summary or missing durations): never presented as fully reliable
  assert.equal(azureMetricReliability({ mean: 80, sampleCount: 3 }), "limited");
  assert.equal(azureMetricReliability({ mean: 80, sampleCount: 3, totalDurationMs: null }), "limited");
});

test("pairing ignores empty answers, answers without a question, and keeps only the first answer per question", () => {
  const turns = [
    { sequenceNumber: 1, speaker: "candidate", content: "Unprompted." },
    { sequenceNumber: 2, speaker: "interviewer", content: "Q1?" },
    { sequenceNumber: 3, speaker: "candidate", content: "   " },
    { sequenceNumber: 4, speaker: "candidate", content: "Real answer." },
    { sequenceNumber: 5, speaker: "candidate", content: "Second part with no new question." },
  ];
  assert.deepEqual(pairInterviewTurns(turns), [{ sequenceNumber: 2, question: "Q1?", answer: "Real answer." }]);
  assert.deepEqual(pairInterviewTurns([]), []);
});
