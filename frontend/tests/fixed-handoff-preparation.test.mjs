import assert from "node:assert/strict";
import test from "node:test";
import { createFixedHandoffPreparationRegistry, FIXED_HANDOFF_RETAIN_MS } from "../src/lib/interview/fixed-handoff-preparation.mjs";

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("prepares transition and two questions independently and reports content-free readiness", async () => {
  let clock = 100;
  const calls = [];
  const registry = createFixedHandoffPreparationRegistry({ now: () => clock, createTurnId: () => "ephemeral-1" });
  const entry = registry.begin({
    voiceKey: "v1", transition: "Transition.", questions: [{ id: "job-1", prompt: "First?" }, { id: "job-2", prompt: "Second?" }],
    prepareSpeech: (value) => { calls.push(typeof value === "string" ? value : value.prompt); return { promise: Promise.resolve(true), cancel() {} }; },
  });
  await Promise.all(entry.handles.map((handle) => handle.promise));
  clock = 250;
  assert.deepEqual(calls, ["Transition.", "First?", "Second?"]);
  assert.deepEqual(registry.metrics(entry), { turnId: "ephemeral-1", plannedCount: 2, readyCount: 2, startedBeforeCompleteMs: 150, readyBeforeCompleteMs: 150 });
  assert.equal(FIXED_HANDOFF_RETAIN_MS, 240_000);
});

test("voice mismatch and leaving cancel every in-flight preparation", () => {
  const gates = [deferred(), deferred(), deferred()];
  let cancelled = 0;
  const registry = createFixedHandoffPreparationRegistry({ createTurnId: () => "turn" });
  const entry = registry.begin({ voiceKey: "a", transition: "T.", questions: [{ id: "1", prompt: "Q1?" }, { id: "2", prompt: "Q2?" }], prepareSpeech: () => { const gate = gates.shift(); return { promise: gate.promise, cancel: () => { cancelled += 1; } }; } });
  assert.equal(registry.take({ turnId: entry.turnId, voiceKey: "b" }), null);
  assert.equal(cancelled, 3);
  registry.begin({ voiceKey: "a", transition: "T.", questions: [], prepareSpeech: () => ({ promise: new Promise(() => {}), cancel: () => { cancelled += 1; } }) });
  registry.cancel();
  assert.equal(cancelled, 4);
});

test("an old turn can never be claimed after a new turn starts", () => {
  let id = 0;
  const registry = createFixedHandoffPreparationRegistry({ createTurnId: () => `turn-${++id}` });
  const prepareSpeech = () => ({ promise: Promise.resolve(true), cancel() {} });
  const old = registry.begin({ transition: "Old.", questions: [], prepareSpeech });
  const current = registry.begin({ transition: "New.", questions: [], prepareSpeech });
  assert.equal(registry.take({ turnId: old.turnId }), null);
  assert.equal(registry.peek(), null);
  assert.equal(current.cancelled, true);
});
