import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { DEFAULT_INTERVIEWER_VOICE, INTERVIEWER_VOICE_OPTIONS } from "../src/lib/interview/voices.mjs";
import { groupVoicesByGender, interviewerVoiceStorageKey, readStoredInterviewerVoice, storeInterviewerVoice, voiceDisplayName, voiceSamplePath, voiceSummary, voiceTraits } from "../src/lib/interview/voice-picker.mjs";

const memoryStorage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k), map };
};

test("display names come from the id and traits are in Portuguese", () => {
  assert.equal(voiceDisplayName("am_echo"), "Echo");
  assert.equal(voiceDisplayName("bf_emma"), "Emma");
  assert.equal(voiceTraits({ gender: "male", accent: "US" }), "masculina, americana");
  assert.equal(voiceTraits({ gender: "female", accent: "UK" }), "feminina, britânica");
  assert.equal(voiceSummary("am_echo"), "Echo · masculina, americana");
  assert.equal(voiceSummary("bf_emma"), "Emma · feminina, britânica");
  assert.equal(voiceSummary("unknown"), "Echo · masculina, americana");
});

test("voices are grouped by gender, cover every option once and flag the default", () => {
  const groups = groupVoicesByGender();
  assert.deepEqual(groups.map((group) => group.label), ["Masculinas", "Femininas"]);
  const ids = groups.flatMap((group) => group.voices.map((voice) => voice.id));
  assert.deepEqual([...ids].sort(), INTERVIEWER_VOICE_OPTIONS.map((voice) => voice.id).sort());
  assert.deepEqual(groups.flatMap((group) => group.voices).filter((voice) => voice.isDefault).map((voice) => voice.id), [DEFAULT_INTERVIEWER_VOICE]);
  assert.ok(groups[0].voices.every((voice) => voice.gender === "male"));
  assert.ok(groups[1].voices.every((voice) => voice.gender === "female"));
});

test("every voice has a static sample in /public/voices", () => {
  for (const voice of INTERVIEWER_VOICE_OPTIONS) {
    const path = voiceSamplePath(voice.id);
    assert.equal(path, `/voices/${voice.id}.mp3`);
    assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)), path);
  }
  assert.equal(voiceSamplePath("nope"), `/voices/${DEFAULT_INTERVIEWER_VOICE}.mp3`);
});

test("the choice persists per browser; the default clears it and bad values are ignored", () => {
  const storage = memoryStorage();
  assert.equal(readStoredInterviewerVoice(storage), DEFAULT_INTERVIEWER_VOICE);
  assert.equal(storeInterviewerVoice(storage, "bf_emma"), true);
  assert.equal(storage.map.get(interviewerVoiceStorageKey), "bf_emma");
  assert.equal(readStoredInterviewerVoice(storage), "bf_emma");
  storage.setItem(interviewerVoiceStorageKey, "garbage");
  assert.equal(readStoredInterviewerVoice(storage), DEFAULT_INTERVIEWER_VOICE);
  storeInterviewerVoice(storage, "af_heart");
  storeInterviewerVoice(storage, DEFAULT_INTERVIEWER_VOICE);
  assert.equal(storage.map.has(interviewerVoiceStorageKey), false);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(readStoredInterviewerVoice(broken), DEFAULT_INTERVIEWER_VOICE);
  assert.equal(storeInterviewerVoice(broken, "bf_emma"), false);
});
