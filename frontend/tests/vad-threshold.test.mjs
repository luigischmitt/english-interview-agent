import assert from "node:assert/strict";
import test from "node:test";
import { getSilenceThreshold, getSpeechThreshold } from "../src/lib/interview/vad-threshold.mjs";

test("calibration stays sensitive when initial frames include speech", () => {
  assert.equal(getSpeechThreshold([0.04, 0.05, 0.018, 0.05, 0.03]), 0.025);
  assert.equal(getSpeechThreshold([0, 0, 0, 0, 0]), 0.015);
  assert.equal(getSpeechThreshold([0.06, 0.05, 0.055, 0.04, 0.045]), 0.025);
});

test("one low calibration dropout cannot make persistent room noise look like speech", () => {
  const speechThreshold = getSpeechThreshold([0.001, 0.02, 0.02, 0.02, 0.02]);
  assert.equal(speechThreshold, 0.025);
  assert.ok(speechThreshold > 0.02);
});

test("quiet-room speech and silence thresholds remain separated", () => {
  const speechThreshold = getSpeechThreshold([0.002, 0.003, 0.004, 0.004, 0.005]);
  assert.equal(speechThreshold, 0.015);
  assert.equal(getSilenceThreshold(speechThreshold), 0.00825);
});
