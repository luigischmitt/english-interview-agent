import assert from "node:assert/strict";
import test from "node:test";
import { pairInterviewTurns, summarizeAzureAssessments } from "../src/lib/interview/report-metrics.mjs";

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
    { sequenceNumber: 3, question: "Main question?", answer: "Main answer." },
    { sequenceNumber: 5, question: "Follow-up?", answer: "A follow-up answer." },
  ]);
});
