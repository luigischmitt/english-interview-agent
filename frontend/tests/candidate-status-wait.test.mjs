import assert from "node:assert/strict";
import test from "node:test";
import { createCandidateStatusWait, shouldWaitForCandidateStatus } from "../src/lib/interview/candidate-status-wait.mjs";

test("the wait resolves true when the matching revision's status arrives", async () => {
  const waiter = createCandidateStatusWait();
  const pending = waiter.wait(3, 1_000);
  waiter.notify(2);
  waiter.notify(3);
  assert.equal(await pending, true);
});

test("the wait times out within its budget and an abort or empty budget resolves false", async () => {
  const waiter = createCandidateStatusWait();
  const started = Date.now();
  assert.equal(await waiter.wait(1, 40), false);
  assert.ok(Date.now() - started < 400);
  assert.equal(await waiter.wait(1, 0), false);
  const controller = new AbortController();
  const aborted = waiter.wait(1, 5_000, { signal: controller.signal });
  controller.abort();
  assert.equal(await aborted, false);
  assert.equal(await waiter.wait(1, 5_000, { signal: controller.signal }), false);
});

test("waits only for a ready, unacceptable FOLLOW_UP of the pending check's revision in this turn without a known verdict", () => {
  const value = { turnId: "t", revision: 2, decision: { decision: "FOLLOW_UP" } };
  const input = { pendingFollowUpCheck: { turnId: "t", revision: 2 }, currentTurnId: "t", readyValues: [value], hasStatus: false, accepted: () => false };
  assert.equal(shouldWaitForCandidateStatus(input), true);
  assert.equal(shouldWaitForCandidateStatus({ ...input, pendingFollowUpCheck: null }), false);
  assert.equal(shouldWaitForCandidateStatus({ ...input, pendingFollowUpCheck: { turnId: "other", revision: 2 } }), false);
  assert.equal(shouldWaitForCandidateStatus({ ...input, pendingFollowUpCheck: { turnId: "t", revision: 3 } }), false);
  assert.equal(shouldWaitForCandidateStatus({ ...input, hasStatus: true }), false);
  assert.equal(shouldWaitForCandidateStatus({ ...input, accepted: () => true }), false);
  assert.equal(shouldWaitForCandidateStatus({ ...input, readyValues: [{ ...value, decision: { decision: "NEXT" } }] }), false);
  assert.equal(shouldWaitForCandidateStatus({ ...input, readyValues: [{ ...value, followUpReleased: true }] }), false);
});
