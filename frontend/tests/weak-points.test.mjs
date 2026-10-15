import test from "node:test";
import assert from "node:assert/strict";
import { buildWeakPointsContext } from "../src/lib/interview/weak-points.mjs";

const report = (overrides = {}) => ({ status: "completed", feedback: { status: "ready", analysis: {
  technicalContent: { gaps: [{ explanation: "Explain the database migration tradeoff." }] },
  englishCommunication: { patterns: [{ type: "GRAMMAR", evidence: "Yesterday I build the service." }] },
  ...overrides,
} } });

test("empty history and non-ready reports produce no focus context", () => {
  assert.equal(buildWeakPointsContext([]), "");
  assert.equal(buildWeakPointsContext([{ ...report(), feedback: { status: "pending", analysis: {} } }]), "");
  assert.match(buildWeakPointsContext([{ status: "completed", feedback: { status: "ready", analysis: {} } }]), /No recurring technical gaps/u);
});

test("uses recent reports first and limits topics, patterns, and total size", () => {
  const recent = report({ technicalContent: { gaps: [{ explanation: "Recent gap" }] }, englishCommunication: { patterns: [{ type: "GRAMMAR", evidence: "Recent example." }] } });
  const older = report({ technicalContent: { gaps: [{ explanation: "Older gap" }] }, englishCommunication: { patterns: [{ type: "GRAMMAR", evidence: "Older example." }] } });
  const context = buildWeakPointsContext([recent, older]);
  assert.ok(context.indexOf("Recent gap") < context.indexOf("Older gap"));
  assert.ok(context.includes("GRAMMAR: Recent example."));
  assert.ok(context.length <= 1200);
  const many = Array.from({ length: 5 }, (_, index) => report({ technicalContent: { gaps: Array.from({ length: 4 }, (_unused, gap) => ({ explanation: `Gap ${index}-${gap}` })) }, englishCommunication: { patterns: Array.from({ length: 5 }, (_unused, pattern) => ({ type: `TYPE${index}-${pattern}`, evidence: "Example." })) } }));
  const bounded = buildWeakPointsContext(many);
  assert.equal((bounded.match(/^- /gmu) ?? []).length, 6);
  assert.ok(bounded.length <= 1200);
});
