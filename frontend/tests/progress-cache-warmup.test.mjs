import assert from "node:assert/strict";
import test from "node:test";
import { warmProgressCacheAfterFeedbackSave } from "../src/lib/interview/progress-cache-warmup.mjs";

test("a successful report save rewarms progress cache asynchronously and hides refresh failures", async () => {
  let calls = 0;
  warmProgressCacheAfterFeedbackSave({ ok: true, value: [] }, async () => {
    calls += 1;
    throw new Error("background refresh failure");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});

test("a failed report save does not rewarm progress cache", async () => {
  let calls = 0;
  warmProgressCacheAfterFeedbackSave({ ok: false, message: "save failed" }, async () => { calls += 1; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});
