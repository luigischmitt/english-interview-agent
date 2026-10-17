import assert from "node:assert/strict";
import test from "node:test";
import { playVoiceSample, voiceSamplePath } from "../src/lib/interview/voice-picker.mjs";
import { INTERVIEWER_VOICE_OPTIONS } from "../src/lib/interview/voices.mjs";

function fakeAudio({ fail = false } = {}) {
  const audio = { src: "", paused: false, onended: null, onerror: null, play: () => fail ? Promise.reject(new Error("blocked")) : Promise.resolve(), pause() { audio.paused = true; } };
  return audio;
}

test("every selectable voice has a static sample path, so testing a voice never calls the speech API", () => {
  for (const option of INTERVIEWER_VOICE_OPTIONS) assert.equal(voiceSamplePath(option.id), `/voices/${option.id}.mp3`);
});

test("the voice test plays the static sample and reports completion, failure and cancellation", async () => {
  let created = null;
  const done = playVoiceSample("en-US-AndrewNeural", (src) => { created = { src, audio: fakeAudio() }; return created.audio; });
  assert.equal(created.src, voiceSamplePath("en-US-AndrewNeural"));
  created.audio.onended();
  assert.deepEqual(await done.promise, { status: "completed" });

  const failed = playVoiceSample("en-US-AndrewNeural", () => fakeAudio({ fail: true }));
  assert.equal((await failed.promise).status, "unavailable");

  const audio = fakeAudio();
  const cancelled = playVoiceSample("en-US-AndrewNeural", () => audio);
  cancelled.cancel();
  assert.deepEqual(await cancelled.promise, { status: "cancelled" });
  assert.equal(audio.paused, true);
});
