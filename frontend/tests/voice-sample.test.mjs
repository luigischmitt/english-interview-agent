import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { playVoiceSample, voiceSamplePath } from "../src/lib/interview/voice-picker.mjs";
import { INTERVIEWER_VOICE_OPTIONS } from "../src/lib/interview/voices.mjs";

function fakeAudio({ fail = false } = {}) {
  const audio = { src: "", paused: false, onended: null, onerror: null, play: () => fail ? Promise.reject(new Error("blocked")) : Promise.resolve(), pause() { audio.paused = true; } };
  return audio;
}

test("every selectable voice has a static sample, so testing a voice never calls the speech API", () => {
  for (const option of INTERVIEWER_VOICE_OPTIONS) assert.ok(existsSync(new URL(`../public${voiceSamplePath(option.id)}`, import.meta.url)), option.id);
});

test("the voice test plays the static sample and reports completion, failure and cancellation", async () => {
  let created = null;
  const done = playVoiceSample("am_echo", (src) => { created = { src, audio: fakeAudio() }; return created.audio; });
  assert.equal(created.src, voiceSamplePath("am_echo"));
  created.audio.onended();
  assert.deepEqual(await done.promise, { status: "completed" });

  const failed = playVoiceSample("am_echo", () => fakeAudio({ fail: true }));
  assert.equal((await failed.promise).status, "unavailable");

  const audio = fakeAudio();
  const cancelled = playVoiceSample("am_echo", () => audio);
  cancelled.cancel();
  assert.deepEqual(await cancelled.promise, { status: "cancelled" });
  assert.equal(audio.paused, true);
});
