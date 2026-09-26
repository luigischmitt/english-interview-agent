import test from "node:test";
import assert from "node:assert/strict";
import { waitForPendingAssessments } from "../src/lib/interview/assessment-report-wait.mjs";

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
