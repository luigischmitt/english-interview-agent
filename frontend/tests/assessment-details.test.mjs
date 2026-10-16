import test from "node:test";
import assert from "node:assert/strict";
import { validateAssessmentDetails } from "../src/lib/interview/assessment-details.mjs";

test("assessment details drop malformed entries and bound clips", () => {
  const validClip = { phraseIndex: 0, startMs: 0, endMs: 1000, mimeType: "audio/webm;codecs=opus", base64: "YQ==" };
  const result = validateAssessmentDetails({
    phrases: [{ phraseIndex: 0, text: "Hello there.", startMs: 0, endMs: 1000, score: 80, issue: "pronunciation", problemWords: [{ word: "Hello", score: 60, errorType: "phoneme", worstPhoneme: "h", prosodyErrors: [] }] }, { phraseIndex: -1 }],
    delivery: { wordsPerMinute: 100, pauseCount: 1, longestPauseMs: 500, startDelayMs: 300, fillerCount: 0, fillers: {} },
    clips: [validClip, validClip, validClip, { ...validClip, base64: "x".repeat(400001) }],
  });
  assert.equal(result.phrases.length, 1);
  assert.equal(result.delivery.wordsPerMinute, 100);
  assert.equal(result.clips.length, 3);
  assert.deepEqual(validateAssessmentDetails({ clips: [{ ...validClip, mimeType: "audio/ogg" }] }), {});
});

test("phrase contract validates issue, phrase index, prosody errors, and at most three clips", () => {
  const phrase = { phraseIndex: 2, text: "Could you ship it?", startMs: 0, endMs: 900, score: 54, issue: "intonation", problemWords: [{ word: "ship", score: null, errorType: null, worstPhoneme: null, prosodyErrors: ["flat"] }] };
  const clip = { phraseIndex: 2, startMs: 0, endMs: 900, mimeType: "audio/webm;codecs=opus", base64: "YQ==" };
  const parsed = validateAssessmentDetails({ phrases: [phrase, { ...phrase, issue: "unknown" }], clips: [clip, clip, clip, clip], sentences: [{ text: "ignored" }] });
  assert.deepEqual(parsed.phrases, [phrase]);
  assert.equal(parsed.clips.length, 3);
  assert.equal("sentences" in parsed, false);
});
