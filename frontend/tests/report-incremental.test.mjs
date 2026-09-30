import test from "node:test";
import assert from "node:assert/strict";
import { collectTurnAnalyses } from "../src/lib/interview/report-incremental.mjs";

const turns = [{ sequenceNumber: 2 }, { sequenceNumber: 4 }];
const analysis = (sequenceNumber) => ({ sequenceNumber, technicalStrengths: [], technicalGaps: [], englishPatterns: [] });

test("returns analyses in turn order when every turn succeeded", async () => {
  const pending = new Map([[4, Promise.resolve(analysis(4))], [2, Promise.resolve(analysis(2))]]);
  const result = await collectTurnAnalyses(turns, pending, { timeoutMs: 100 });
  assert.equal(result.complete, true);
  assert.deepEqual(result.analyses.map((entry) => entry.sequenceNumber), [2, 4]);
});

test("waits for an analysis that settles before the deadline", async () => {
  const late = new Promise((resolve) => setTimeout(() => resolve(analysis(4)), 15));
  const result = await collectTurnAnalyses(turns, new Map([[2, Promise.resolve(analysis(2))], [4, late]]), { timeoutMs: 200 });
  assert.equal(result.complete, true);
});

test("is incomplete and bounded when an analysis stays pending", async () => {
  const startedAt = Date.now();
  const never = new Promise(() => {});
  const result = await collectTurnAnalyses(turns, new Map([[2, Promise.resolve(analysis(2))], [4, never]]), { timeoutMs: 25 });
  assert.equal(result.complete, false);
  assert.equal(result.missing, 1);
  assert.ok(Date.now() - startedAt < 500);
});

test("treats failed, rejected or never-started analyses as missing", async () => {
  assert.equal((await collectTurnAnalyses(turns, new Map([[2, Promise.resolve(null)], [4, Promise.resolve(analysis(4))]]), { timeoutMs: 50 })).complete, false);
  assert.equal((await collectTurnAnalyses(turns, new Map([[2, Promise.reject(new Error("boom"))], [4, Promise.resolve(analysis(4))]]), { timeoutMs: 50 })).complete, false);
  assert.equal((await collectTurnAnalyses(turns, new Map([[2, Promise.resolve(analysis(2))]]), { timeoutMs: 50 })).complete, false);
});

test("never reports a complete result without turns", async () => {
  assert.equal((await collectTurnAnalyses([], new Map(), { timeoutMs: 10 })).complete, false);
});
