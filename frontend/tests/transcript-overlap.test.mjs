import assert from "node:assert/strict";
import test from "node:test";

import { mergeTranscriptWindow } from "../src/lib/interview/transcript-overlap.mjs";
import { getSilenceThreshold, getSpeechThreshold } from "../src/lib/interview/vad-threshold.mjs";

test("merges a matching multiword window overlap without repeating it", () => {
  assert.equal(mergeTranscriptWindow("I owned the service migration", "service migration and reduced latency"), "I owned the service migration and reduced latency");
});

test("compares boundary words without punctuation or casing", () => {
  assert.equal(mergeTranscriptWindow("We shipped the API.", "THE api, then added retries."), "We shipped the API. then added retries.");
});

test("keeps repeated single words when there is not a safe multiword match", () => {
  assert.equal(mergeTranscriptWindow("I, I led the team", "I led the team through launch"), "I, I led the team through launch");
});

test("does not remove unrelated text", () => {
  assert.equal(mergeTranscriptWindow("I designed an API", "Then I added caching"), "I designed an API Then I added caching");
});

test("tolerates one ASR divergence inside a strongly matching overlap", () => {
  assert.equal(mergeTranscriptWindow("I reviewed the database queries carefully", "I reviewed the database request carefully and added indexes"), "I reviewed the database queries carefully and added indexes");
});

test("keeps all new content when the apparent overlap is weak", () => {
  assert.equal(mergeTranscriptWindow("I reviewed the database", "I changed the service and added indexes"), "I reviewed the database I changed the service and added indexes");
});

test("calibrates RMS thresholds using the existing average-times-2.5 rule", () => {
  assert.equal(getSpeechThreshold([0.01, 0.03]), 0.05);
  assert.equal(getSpeechThreshold([0.001, 0.001]), 0.025);
  assert.equal(getSpeechThreshold([0.2, 0.2]), 0.15);
  assert.equal(getSilenceThreshold(0.1), 0.065);
});
