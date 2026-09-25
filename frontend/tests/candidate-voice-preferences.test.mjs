import assert from "node:assert/strict";
import test from "node:test";
import { defaultCandidateVoicePreferences, resolveCandidateVoicePreferences } from "../src/lib/interview/candidate-voice-preferences.mjs";

test("candidate transcript captions default on without coupling auto-capture", () => {
  assert.deepEqual(defaultCandidateVoicePreferences, {
    showCandidateTranscript: true,
    autoCaptureVoice: true,
  });
  assert.deepEqual(resolveCandidateVoicePreferences(defaultCandidateVoicePreferences), defaultCandidateVoicePreferences);
});

test("hiding candidate captions preserves voice transcription and automatic capture settings", () => {
  assert.deepEqual(resolveCandidateVoicePreferences({ showCandidateTranscript: false, autoCaptureVoice: true }), {
    showCandidateTranscript: false,
    autoCaptureVoice: true,
  });
});

test("legacy transcription preference migrates to caption visibility only", () => {
  assert.deepEqual(resolveCandidateVoicePreferences({ transcribeCandidateVoice: false, autoCaptureVoice: true }), {
    showCandidateTranscript: false,
    autoCaptureVoice: true,
  });
});
