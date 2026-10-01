import assert from "node:assert/strict";
import test from "node:test";
import { defaultCandidateVoicePreferences, resolveCandidateVoicePreferences } from "../src/lib/interview/candidate-voice-preferences.mjs";

test("automatic microphone capture defaults on", () => {
  assert.deepEqual(defaultCandidateVoicePreferences, {
    autoCaptureVoice: true,
    showCandidateCaptions: true,
  });
  assert.deepEqual(resolveCandidateVoicePreferences(defaultCandidateVoicePreferences), defaultCandidateVoicePreferences);
});

test("automatic microphone capture remains configurable", () => {
  assert.deepEqual(resolveCandidateVoicePreferences({ autoCaptureVoice: false }), {
    autoCaptureVoice: false,
    showCandidateCaptions: true,
  });
});

test("live candidate captions default on and can be turned off", () => {
  assert.equal(defaultCandidateVoicePreferences.showCandidateCaptions, true);
  assert.equal(resolveCandidateVoicePreferences({}).showCandidateCaptions, true);
  assert.equal(resolveCandidateVoicePreferences({ showCandidateCaptions: false }).showCandidateCaptions, false);
});
