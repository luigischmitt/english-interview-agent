import assert from "node:assert/strict";
import test from "node:test";
import { defaultCandidateVoicePreferences, resolveCandidateVoicePreferences } from "../src/lib/interview/candidate-voice-preferences.mjs";

test("automatic microphone capture defaults on", () => {
  assert.deepEqual(defaultCandidateVoicePreferences, {
    autoCaptureVoice: true,
  });
  assert.deepEqual(resolveCandidateVoicePreferences(defaultCandidateVoicePreferences), defaultCandidateVoicePreferences);
});

test("automatic microphone capture remains configurable", () => {
  assert.deepEqual(resolveCandidateVoicePreferences({ autoCaptureVoice: false }), {
    autoCaptureVoice: false,
  });
});
