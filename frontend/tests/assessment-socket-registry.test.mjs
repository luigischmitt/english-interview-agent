import assert from "node:assert/strict";
import test from "node:test";
import { AssessmentSocketRegistry } from "../src/lib/interview/assessment-socket-registry.mjs";

function fakeSocket() {
  return { onmessage() {}, onclose() {}, onerror() {}, closeCount: 0, close() { this.closeCount += 1; } };
}

test("an older assessment can finish without closing a newer recording", () => {
  const registry = new AssessmentSocketRegistry();
  const earlier = fakeSocket();
  const current = fakeSocket();
  registry.register("earlier-attempt", earlier);
  registry.register("current-attempt", current);

  registry.finish("earlier-attempt", earlier);
  assert.equal(earlier.closeCount, 0);
  assert.equal(current.closeCount, 0);

  registry.closeAll();
  assert.equal(current.closeCount, 1);
  assert.equal(current.onmessage, null);
  assert.equal(current.onclose, null);
  assert.equal(current.onerror, null);
});

test("a stale socket cannot unregister its replacement and room exit detaches it", () => {
  const registry = new AssessmentSocketRegistry();
  const stale = fakeSocket();
  const replacement = fakeSocket();
  registry.register("same-attempt", stale);
  registry.register("same-attempt", replacement);
  registry.finish("same-attempt", stale);
  registry.closeAll();

  assert.equal(stale.closeCount, 0);
  assert.equal(replacement.closeCount, 1);
  assert.equal(replacement.onmessage, null);
  assert.equal(replacement.onclose, null);
  assert.equal(replacement.onerror, null);
});
