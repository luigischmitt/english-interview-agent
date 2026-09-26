import assert from "node:assert/strict";
import test from "node:test";
import { canSkipVoiceQuestion, canStartNextQuestion, createOnceGate, finalTranscriptForSubmission, hasReachedTimeLimit, interviewDurationOptions, nextAutoStartSignal, nullableQuestionCount, stopMediaStreamTracks } from "../src/lib/interview/session-policy.mjs";

test("the time limit never cuts an active answer, but blocks starting another question", () => {
  const durationMinutes = 5;
  const elapsedAtAnswerStart = 4 * 60 + 55;
  assert.equal(hasReachedTimeLimit(elapsedAtAnswerStart, durationMinutes), false);
  assert.equal(hasReachedTimeLimit(5 * 60, durationMinutes), true);
  assert.equal(canStartNextQuestion(5 * 60, durationMinutes, 1, 8), false);
  assert.equal(canStartNextQuestion(4 * 60 + 59, durationMinutes, 1, 8), true);
});

test("the report generation gate can be claimed exactly once", () => {
  const claim = createOnceGate();
  assert.equal(claim(), true);
  assert.equal(claim(), false);
  assert.equal(claim(), false);
});

test("the internal question bank ends honestly when its eight prompts are exhausted", () => {
  assert.equal(canStartNextQuestion(4 * 60, 5, 8, 8), false);
});

test("automatic microphone start only accepts each enabled signal once", () => {
  assert.equal(nextAutoStartSignal("question-1", false, null), "question-1");
  assert.equal(nextAutoStartSignal("question-1", false, "question-1"), null);
  assert.equal(nextAutoStartSignal("question-2", true, "question-1"), null);
});

test("only a non-empty final voice transcript can be submitted", () => {
  assert.equal(finalTranscriptForSubmission({ status: "failed", transcript: "I built" }), null);
  assert.equal(finalTranscriptForSubmission({ status: "pending" }), null);
  assert.equal(finalTranscriptForSubmission({ status: "available", value: { transcript: "  " } }), null);
  assert.equal(finalTranscriptForSubmission({ status: "available", value: { transcript: "  I built the service.  " } }), "I built the service.");
});

test("an unfinished capture or transcript cannot silently skip a question", () => {
  for (const captureState of ["requesting", "listening", "detected", "finalizing"]) {
    assert.equal(canSkipVoiceQuestion(captureState, "idle"), false);
  }
  assert.equal(canSkipVoiceQuestion("idle", "pending"), false);
  assert.equal(canSkipVoiceQuestion("idle", "failed"), true);
  assert.equal(canSkipVoiceQuestion("ready", "available"), true);
});

test("camera and microphone stream cleanup stops every local track", () => {
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped += 1; } }, { stop: () => { stopped += 1; } }] };
  stopMediaStreamTracks(stream);
  stopMediaStreamTracks(null);
  assert.equal(stopped, 2);
});

test("setup exposes supported durations and session persistence accepts no question count", () => {
  assert.deepEqual(interviewDurationOptions, [5, 10, 15, 25]);
  assert.equal(nullableQuestionCount(null), null);
  assert.equal(nullableQuestionCount(""), null);
  assert.equal(nullableQuestionCount("8"), 8);
});
