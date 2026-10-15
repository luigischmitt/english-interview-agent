import test from "node:test";
import assert from "node:assert/strict";
import { validateAssessmentDetails } from "../src/lib/interview/assessment-details.mjs";

test("assessment details drop malformed entries and bound clips", () => {
  const validClip = { sentenceIndex: 0, startMs: 0, endMs: 1000, mimeType: "audio/webm;codecs=opus", base64: "YQ==" };
  const result = validateAssessmentDetails({
    sentences: [{ sentenceIndex: 0, text: "Hello.", startMs: 0, endMs: 1000, score: 80, problemWords: [] }, { sentenceIndex: -1 }],
    delivery: { wordsPerMinute: 100, pauseCount: 1, longestPauseMs: 500, startDelayMs: 300, fillerCount: 0, fillers: {} },
    clips: [validClip, validClip, validClip, { ...validClip, base64: "x".repeat(400001) }],
  });
  assert.equal(result.sentences.length, 1);
  assert.equal(result.delivery.wordsPerMinute, 100);
  assert.equal(result.clips.length, 2);
  assert.deepEqual(validateAssessmentDetails({ clips: [{ ...validClip, mimeType: "audio/ogg" }] }), {});
});
