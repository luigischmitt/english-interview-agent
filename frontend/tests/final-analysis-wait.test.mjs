import assert from "node:assert/strict";
import test from "node:test";
import { FINAL_ANALYSIS_WAIT_MS, FOLLOW_UP_TOTAL_WAIT_MS, finalAnalysisWaitPredicate, pendingFinalAnalysisPredicate, remainingBudgetMs } from "../src/lib/interview/final-analysis-wait.mjs";
import { composeAcknowledgedQuestion } from "../src/lib/interview/speech-playback.mjs";
import { stripLeadingAcknowledgement } from "../src/lib/interview/acknowledgement.mjs";

const pending = (transcript, revision) => ({ transcript, revision, settled: "pending" });
const ready = (transcript, revision) => ({ transcript, revision, settled: "ready" });

test("budgets are counted from submit and never negative", () => {
  assert.equal(remainingBudgetMs(FINAL_ANALYSIS_WAIT_MS, 1_000, 1_500), 1_300);
  assert.equal(remainingBudgetMs(FOLLOW_UP_TOTAL_WAIT_MS, 0, 5_000), 0);
  assert.equal(FINAL_ANALYSIS_WAIT_MS, 1_800);
  assert.equal(FOLLOW_UP_TOTAL_WAIT_MS, 4_500);
  assert.ok(FOLLOW_UP_TOTAL_WAIT_MS > FINAL_ANALYSIS_WAIT_MS);
});

test("waits for the pending entry whose transcript equals the final one (trimmed)", () => {
  const predicate = pendingFinalAnalysisPredicate([ready("old", 1), pending(" final answer ", 2)], "final answer");
  assert.ok(predicate);
  assert.equal(predicate({ transcript: "final answer", revision: 2 }), true);
  assert.equal(predicate({ transcript: "old", revision: 1 }), false);
});

test("never waits for a pending revision whose transcript differs from the final one", () => {
  assert.equal(pendingFinalAnalysisPredicate([ready("a", 1), pending("a b", 2)], "a b c"), null);
  assert.equal(pendingFinalAnalysisPredicate([pending("a", 1), ready("a b", 2)], "a b c"), null);
});

test("no pending revision means no wait", () => {
  assert.equal(pendingFinalAnalysisPredicate([ready("a", 1)], "a"), null);
  assert.equal(pendingFinalAnalysisPredicate([], "a"), null);
});

test("an accepted ready follow-up, or an ineligible path, skips the wait", () => {
  const base = { entries: [pending("final", 2)], finalTranscript: "final", acceptFollowUp: () => true };
  const followUp = { decision: { decision: "FOLLOW_UP" } };
  assert.equal(finalAnalysisWaitPredicate({ ...base, eligible: true, readyValues: [followUp] }), null);
  assert.ok(finalAnalysisWaitPredicate({ ...base, eligible: true, readyValues: [{ decision: { decision: "NEXT" } }] }));
  assert.ok(finalAnalysisWaitPredicate({ ...base, eligible: true, readyValues: [followUp], acceptFollowUp: () => false }));
  assert.equal(finalAnalysisWaitPredicate({ ...base, eligible: false, readyValues: [] }), null);
});

test("after the instant acknowledgement the handoff starts with the question, not a second acknowledgement", () => {
  assert.equal(composeAcknowledgedQuestion(stripLeadingAcknowledgement("Okay, thanks."), "Tell me about a trade-off."), "Tell me about a trade-off.");
  assert.equal(composeAcknowledgedQuestion(stripLeadingAcknowledgement("Thanks for that. Let's move on."), "How do you test?"), "How do you test?");
});
