import test from "node:test";
import assert from "node:assert/strict";
import { createFeedbackPersistenceSignature, waitForPendingAssessments } from "../src/lib/interview/assessment-report-wait.mjs";
import { summarizeAzureAssessments } from "../src/lib/interview/report-metrics.mjs";

test("waits for assessment callbacks that finish during the report handoff", async () => {
  let pending = 1;
  setTimeout(() => { pending = 0; }, 15);
  const remaining = await waitForPendingAssessments(() => pending, { timeoutMs: 100, pollMs: 5 });
  assert.equal(remaining, 0);
});

test("caps the report handoff wait when an assessment stays pending", async () => {
  const startedAt = Date.now();
  const remaining = await waitForPendingAssessments(() => 1, { timeoutMs: 25, pollMs: 5 });
  assert.equal(remaining, 1);
  assert.ok(Date.now() - startedAt < 250);
});

test("includes an assessment that finishes during the bounded handoff and changes the persistence signature", async () => {
  let assessment = { status: "pending" };
  setTimeout(() => {
    assessment = { status: "available", durationMs: 4_000, scores: { accuracy: 84, fluency: 78, prosody: 73 } };
  }, 15);
  const pendingSummary = summarizeAzureAssessments([assessment]);
  const report = { technicalContent: { summary: "Grounded report", strengths: [], gaps: [] } };
  const pendingSignature = createFeedbackPersistenceSignature({ sessionId: "session", status: "ready", result: report, azureSummary: pendingSummary });

  const remaining = await waitForPendingAssessments(() => assessment.status === "pending" ? 1 : 0, { timeoutMs: 100, pollMs: 5 });
  const completedSummary = summarizeAzureAssessments([assessment]);
  const completedSignature = createFeedbackPersistenceSignature({ sessionId: "session", status: "ready", result: report, azureSummary: completedSummary });

  assert.equal(remaining, 0);
  assert.equal(completedSummary.accuracy.mean, 84);
  assert.equal(completedSummary.accuracy.sampleCount, 1);
  assert.notEqual(completedSignature, pendingSignature);
});
