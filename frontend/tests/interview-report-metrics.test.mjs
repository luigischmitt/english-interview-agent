import assert from "node:assert/strict";
import test from "node:test";
import { answerOrdinalForSequence, pairInterviewTurns, summarizeAzureAssessments } from "../src/lib/interview/report-metrics.mjs";

test("Azure means ignore unavailable, pending, null, and invalid dimension values while counting valid samples", () => {
  const summary = summarizeAzureAssessments([
    { status: "available", scores: { accuracy: 80, fluency: null, prosody: 70 } },
    { status: "unavailable" },
    { status: "pending" },
    { status: "available", scores: { accuracy: 90, fluency: 60, prosody: 110 } },
  ]);
  assert.deepEqual(summary, {
    accuracy: { mean: 85, sampleCount: 2 },
    fluency: { mean: 60, sampleCount: 1 },
    prosody: { mean: 70, sampleCount: 1 },
  });
});

test("Azure dimensions with no usable score have null means and zero samples", () => {
  assert.deepEqual(summarizeAzureAssessments([{ status: "unavailable" }, { status: "available", scores: { accuracy: null, fluency: null, prosody: null } }]), {
    accuracy: { mean: null, sampleCount: 0 }, fluency: { mean: null, sampleCount: 0 }, prosody: { mean: null, sampleCount: 0 },
  });
});

test("weights Azure samples by response duration when provided", () => {
  const summary = summarizeAzureAssessments([
    { status: "available", durationMs: 1_000, scores: { accuracy: 50, fluency: 50, prosody: 50 } },
    { status: "available", durationMs: 3_000, scores: { accuracy: 90, fluency: 90, prosody: 90 } },
  ]);
  assert.deepEqual(summary, {
    accuracy: { mean: 80, sampleCount: 2 },
    fluency: { mean: 80, sampleCount: 2 },
    prosody: { mean: 80, sampleCount: 2 },
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
