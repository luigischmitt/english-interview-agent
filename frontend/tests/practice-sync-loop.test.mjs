import test from "node:test";
import assert from "node:assert/strict";
import { syncPracticeGroupsUntilDone } from "../src/lib/practice/practice-sync-loop.mjs";

const success = (themes, remaining) => ({ ok: true, value: { themes, remaining } });

test("stops when remaining is false", async () => {
  let calls = 0;
  await syncPracticeGroupsUntilDone([], {
    maxBatches: 10,
    sync: async (themes) => {
      calls += 1;
      return success(themes, false);
    },
  });
  assert.equal(calls, 1);
});

test("stops at maxBatches", async () => {
  let calls = 0;
  await syncPracticeGroupsUntilDone([], {
    maxBatches: 3,
    sync: async (themes) => {
      calls += 1;
      return success(themes, true);
    },
  });
  assert.equal(calls, 3);
});

test("stops silently on failure", async () => {
  let calls = 0;
  await assert.doesNotReject(syncPracticeGroupsUntilDone([], {
    maxBatches: 10,
    sync: async () => {
      calls += 1;
      return { ok: false, message: "failed" };
    },
  }));
  assert.equal(calls, 1);
});

test("passes each batch's themes to the next call", async () => {
  const inputs = [];
  const first = [{ id: "first" }];
  const second = [{ id: "second" }];
  await syncPracticeGroupsUntilDone(first, {
    maxBatches: 3,
    sync: async (themes) => {
      inputs.push(themes);
      return inputs.length === 1 ? success(second, true) : success(second, false);
    },
  });
  assert.deepEqual(inputs, [first, second]);
});
