import test from "node:test";
import assert from "node:assert/strict";
import { collectTurnAnalyses, finalTurnAnalysisMs } from "../src/lib/interview/report-incremental.mjs";

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

import { analyzeTurnWithRetry, missingSequenceNumbers, resolveReportAtEnd, settleTurnAnalyses } from "../src/lib/interview/report-incremental.mjs";

const t = (n) => ({ sequenceNumber: n });
const noSleep = async () => {};

test("missingSequenceNumbers lists turns without analysis", () => {
  assert.deepEqual(missingSequenceNumbers([t(1), t(2), t(3)], new Map([[2, analysis(2)]])), [1, 3]);
});

test("background retry recovers a failed analysis once", async () => {
  let calls = 0; let retried = 0;
  const result = await analyzeTurnWithRetry({ turn: t(1), analyze: async () => { if (++calls === 1) throw new Error("x"); return analysis(1); }, sleep: noSleep, onRetry: () => { retried += 1; } });
  assert.equal(result.sequenceNumber, 1); assert.equal(calls, 2); assert.equal(retried, 1);
});

test("background retry happens only once", async () => {
  let calls = 0;
  const result = await analyzeTurnWithRetry({ turn: t(1), analyze: async () => { calls += 1; throw new Error("x"); }, sleep: noSleep });
  assert.equal(result, null); assert.equal(calls, 2);
});

test("abort does not retry, including during the delay", async () => {
  const c1 = new AbortController(); let calls = 0;
  assert.equal(await analyzeTurnWithRetry({ turn: t(1), signal: c1.signal, analyze: async () => { calls += 1; c1.abort(); throw new Error("aborted"); }, sleep: noSleep }), null);
  assert.equal(calls, 1);
  const c2 = new AbortController(); calls = 0;
  assert.equal(await analyzeTurnWithRetry({ turn: t(1), signal: c2.signal, analyze: async () => { calls += 1; throw new Error("x"); }, sleep: async () => { c2.abort(); } }), null);
  assert.equal(calls, 1);
});

test("settleTurnAnalyses keeps only successes", async () => {
  const map = await settleTurnAnalyses([t(1), t(2)], new Map([[1, Promise.resolve(analysis(1))], [2, Promise.resolve(null)]]), { timeoutMs: 50 });
  assert.deepEqual([...map.keys()], [1]);
});

const flow = (overrides) => {
  const calls = { analyze: [], consolidate: 0, full: 0 };
  const base = {
    turns: [t(1), t(2)],
    settled: new Map([[1, analysis(1)], [2, analysis(2)]]),
    analyze: async (turn) => { calls.analyze.push(turn.sequenceNumber); return analysis(turn.sequenceNumber); },
    consolidate: async (list) => { calls.consolidate += 1; calls.list = list; return "consolidated"; },
    fullReport: async () => { calls.full += 1; return "full"; },
    finalAttemptMs: 50,
  };
  return { calls, run: () => resolveReportAtEnd({ ...base, ...overrides }) };
};

test("all analyses ready consolidates directly", async () => {
  const { calls, run } = flow({});
  const out = await run();
  assert.deepEqual(out, { result: "consolidated", path: "incremental", missingAtEnd: 0, recoveredAtEnd: 0 });
  assert.deepEqual(calls.analyze, []); assert.equal(calls.full, 0);
});

test("missing at end is recovered in parallel and consolidated in turn order", async () => {
  const { calls, run } = flow({ turns: [t(1), t(2), t(3), t(4)], settled: Promise.resolve(new Map([[2, analysis(2)], [4, analysis(4)]])) });
  const out = await run();
  assert.equal(out.path, "incremental"); assert.equal(out.missingAtEnd, 2); assert.equal(out.recoveredAtEnd, 2);
  assert.deepEqual(calls.analyze.sort(), [1, 3]);
  assert.deepEqual(calls.list.map((a) => a.sequenceNumber), [1, 2, 3, 4]);
  assert.equal(calls.full, 0);
});

test("more than half missing skips the final attempts and uses the full report", async () => {
  const { calls, run } = flow({ turns: [t(1), t(2), t(3)], settled: Promise.resolve(new Map([[2, analysis(2)]])) });
  const out = await run();
  assert.equal(out.path, "fallback"); assert.equal(out.result, "full"); assert.equal(out.missingAtEnd, 2);
  assert.deepEqual(calls.analyze, []); assert.equal(calls.consolidate, 0);
});

test("still missing after final attempt falls back to full report", async () => {
  const { calls, run } = flow({ settled: new Map([[1, analysis(1)]]), analyze: async () => { throw new Error("x"); } });
  const out = await run();
  assert.equal(out.path, "fallback"); assert.equal(out.result, "full"); assert.equal(out.missingAtEnd, 1);
  assert.equal(calls.consolidate, 0);
});

test("final attempt is bounded by its deadline", async () => {
  const { run } = flow({ settled: new Map([[1, analysis(1)]]), analyze: (_turn, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")))), finalAttemptMs: 20 });
  const out = await run();
  assert.equal(out.path, "fallback");
});

test("consolidation failure falls back to full report", async () => {
  const { calls, run } = flow({ consolidate: async () => { throw new Error("x"); } });
  const out = await run();
  assert.equal(out.path, "fallback"); assert.equal(calls.full, 1);
});

test("abort at the end skips the final attempts", async () => {
  const c = new AbortController(); c.abort();
  const { calls, run } = flow({ settled: new Map(), signal: c.signal });
  await run();
  assert.deepEqual(calls.analyze, []);
});

test("the end-of-interview recovery deadline is 30 s, matching the backend turn analysis timeout", () => {
  assert.equal(finalTurnAnalysisMs, 30_000);
});

test("a turn that already failed its automatic retry is not re-sent at the end and goes straight to the fallback", async () => {
  const { calls, run } = flow({ turns: [t(1), t(2), t(3)], settled: new Map([[1, analysis(1)], [2, analysis(2)]]), exhausted: new Set([3]) });
  const out = await run();
  assert.equal(out.path, "fallback"); assert.equal(out.result, "full");
  assert.deepEqual(calls.analyze, []); assert.equal(calls.consolidate, 0);
});
