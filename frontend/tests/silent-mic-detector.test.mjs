import assert from "node:assert/strict";
import test from "node:test";
import { createSilentMicDetector } from "../src/lib/interview/silent-mic-detector.mjs";

function feed(detector, level, fromMs, toMs) {
  for (let t = fromMs; t <= toMs; t += 100) detector.pushLevel(level);
}

test("dead input fires silent at 3 s, not before", () => {
  const d = createSilentMicDetector({ startedAtMs: 1000 });
  feed(d, 0, 1000, 3900);
  assert.equal(d.evaluate(3999), "ok");
  assert.equal(d.evaluate(4000), "silent");
});

test("low but normal room noise is not a dead input", () => {
  const d = createSilentMicDetector({ startedAtMs: 0 });
  feed(d, 0.004, 0, 3000);
  assert.equal(d.evaluate(3000), "ok");
  assert.equal(d.evaluate(9999), "ok");
});

test("no_voice fires at 10 s without speech-started", () => {
  const d = createSilentMicDetector({ startedAtMs: 0 });
  feed(d, 0.01, 0, 10000);
  assert.equal(d.evaluate(9999), "ok");
  assert.equal(d.evaluate(10000), "no_voice");
});

test("silent clears when signal appears, then falls back to no_voice", () => {
  const d = createSilentMicDetector({ startedAtMs: 0 });
  assert.equal(d.evaluate(3500), "silent");
  d.pushLevel(0.01);
  assert.equal(d.evaluate(3600), "ok");
  assert.equal(d.evaluate(10000), "no_voice");
});

test("never fires after speech-started, even if input goes quiet", () => {
  const d = createSilentMicDetector({ startedAtMs: 0 });
  d.markSpeechStarted();
  assert.equal(d.evaluate(3500), "ok");
  assert.equal(d.evaluate(60000), "ok");
});

test("speech-started clears an active notice", () => {
  const d = createSilentMicDetector({ startedAtMs: 0 });
  assert.equal(d.evaluate(5000), "silent");
  d.markSpeechStarted();
  assert.equal(d.evaluate(5100), "ok");
});

test("reset starts a fresh attempt", () => {
  const d = createSilentMicDetector({ startedAtMs: 0 });
  assert.equal(d.evaluate(11000), "silent");
  d.reset(11000);
  assert.equal(d.evaluate(11500), "ok");
  assert.equal(d.evaluate(14000), "silent");
});
