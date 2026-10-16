import test from "node:test";
import assert from "node:assert/strict";
import { parseReviewedTranscript } from "../src/lib/interview/reviewed-transcript.mjs";
import { replaceCandidateTurnContent, waitForReviewedTranscriptOrTimeout } from "../src/lib/interview/report-incremental.mjs";

test("accepts and trims a bounded reviewed transcript", () => {
  assert.equal(parseReviewedTranscript({ type: "reviewed_transcript", transcript: "  I shipped the feature.  ", changed: true }), "I shipped the feature.");
});

test("rejects unavailable, malformed, empty and oversized reviewed transcripts", () => {
  assert.equal(parseReviewedTranscript({ type: "reviewed_transcript", status: "unavailable" }), null);
  assert.equal(parseReviewedTranscript({ type: "reviewed_transcript", transcript: "  " }), null);
  assert.equal(parseReviewedTranscript({ type: "reviewed_transcript", transcript: "x".repeat(6001) }), null);
  assert.equal(parseReviewedTranscript({ type: "other", transcript: "valid" }), null);
});

test("uses reviewed transcript when available and the draft after timeout", async () => {
  assert.equal(await waitForReviewedTranscriptOrTimeout(Promise.resolve("reviewed"), "draft", { timeoutMs: 30 }), "reviewed");
  assert.equal(await waitForReviewedTranscriptOrTimeout(new Promise(() => {}), "draft", { timeoutMs: 5 }), "draft");
});

test("replaces only the requested candidate turn", () => {
  const turns = [{ sequenceNumber: 1, speaker: "interviewer", content: "Question" }, { sequenceNumber: 2, speaker: "candidate", content: "Draft" }];
  assert.deepEqual(replaceCandidateTurnContent(turns, 2, "Reviewed"), [turns[0], { ...turns[1], content: "Reviewed" }]);
  assert.deepEqual(turns[1].content, "Draft");
});
