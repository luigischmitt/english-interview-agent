import assert from "node:assert/strict";
import test from "node:test";
import { emptyCaption, hasCaptionText, maximumCaptionCharacters, parseCaptionMessage, reduceCaption, shouldShowCandidateCaption } from "../src/lib/interview/caption-state.mjs";

test("parses caption messages and ignores other messages", () => {
  assert.deepEqual(parseCaptionMessage({ type: "caption", committed: " I led  the team. ", partial: "and we" }), { committed: "I led the team.", partial: "and we" });
  assert.deepEqual(parseCaptionMessage({ type: "caption" }), { committed: "", partial: "" });
  assert.deepEqual(parseCaptionMessage({ type: "caption", committed: 4, partial: null }), { committed: "", partial: "" });
  assert.equal(parseCaptionMessage({ type: "complete", transcript: "x" }), null);
  assert.equal(parseCaptionMessage(null), null);
});

test("keeps only the latest characters of very long captions", () => {
  const parsed = parseCaptionMessage({ type: "caption", committed: `old ${"a".repeat(maximumCaptionCharacters)}`, partial: "" });
  assert.equal(parsed.committed.length, maximumCaptionCharacters);
  assert.equal(parsed.committed.endsWith("a"), true);
});

test("reduceCaption preserves identity when unchanged and clears on null", () => {
  const first = reduceCaption(emptyCaption, { committed: "One.", partial: "two" });
  assert.deepEqual(first, { committed: "One.", partial: "two" });
  assert.equal(reduceCaption(first, { committed: "One.", partial: "two" }), first);
  assert.deepEqual(reduceCaption(first, { committed: "One. Two.", partial: "" }), { committed: "One. Two.", partial: "" });
  assert.equal(reduceCaption(first, null), emptyCaption);
  assert.equal(reduceCaption(emptyCaption, null), emptyCaption);
  assert.equal(reduceCaption(emptyCaption, { committed: " ", partial: "" }), emptyCaption);
});

test("hasCaptionText and visibility rules", () => {
  const caption = { committed: "", partial: "hello" };
  assert.equal(hasCaptionText(emptyCaption), false);
  assert.equal(hasCaptionText(caption), true);
  assert.equal(shouldShowCandidateCaption({ enabled: true, captureState: "listening", caption }), true);
  assert.equal(shouldShowCandidateCaption({ enabled: true, captureState: "detected", caption }), true);
  assert.equal(shouldShowCandidateCaption({ enabled: false, captureState: "listening", caption }), false);
  assert.equal(shouldShowCandidateCaption({ enabled: true, captureState: "listening", caption: emptyCaption }), false);
  assert.equal(shouldShowCandidateCaption({ enabled: true, captureState: "finalizing", caption }), false);
  assert.equal(shouldShowCandidateCaption({ enabled: true, captureState: "idle", caption }), false);
});
