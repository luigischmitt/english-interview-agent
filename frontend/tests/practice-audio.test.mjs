import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import { collectFixedPracticePhrases, PRACTICE_AUDIO_VOICE, practiceAudioHash, staticPracticeAudioUrl } from "../src/lib/practice/practice-audio.mjs";
import { practiceLessons } from "../src/lib/practice/practice-lessons.mjs";

const manifest = JSON.parse(readFileSync(new URL("../src/lib/practice/practice-audio-manifest.json", import.meta.url), "utf8"));

test("the hash is stable, 16 hex chars, and depends on voice and normalized text", () => {
  assert.equal(practiceAudioHash("I work at Nubank."), practiceAudioHash("  I work   at Nubank. "));
  assert.match(practiceAudioHash("I work at Nubank."), /^[0-9a-f]{16}$/u);
  assert.notEqual(practiceAudioHash("I work at Nubank."), practiceAudioHash("I work at Nubank"));
  assert.notEqual(practiceAudioHash("I work at Nubank."), practiceAudioHash("I work at Nubank.", "af_heart"));
  assert.equal(practiceAudioHash("I work at Nubank.", PRACTICE_AUDIO_VOICE), practiceAudioHash("I work at Nubank."));
});

test("manifest lookup hits fixed phrases and misses dynamic ones", () => {
  const files = { [practiceAudioHash("I work at Nubank.")]: "abc.mp3" };
  assert.equal(staticPracticeAudioUrl(" I work at  Nubank. ", files), "/audio/practice/abc.mp3");
  assert.equal(staticPracticeAudioUrl("Something the person wrote", files), null);
  assert.equal(staticPracticeAudioUrl("", files), null);
});

test("every fixed lesson phrase has a generated audio file (regenerate with npm run audio:practice after content edits)", () => {
  const phrases = collectFixedPracticePhrases(practiceLessons);
  assert.ok(phrases.length > 100);
  assert.equal(manifest.voice, PRACTICE_AUDIO_VOICE);
  const missing = phrases.filter((phrase) => !staticPracticeAudioUrl(phrase, manifest.files));
  assert.deepEqual(missing, []);
  assert.equal(Object.keys(manifest.files).length, phrases.length, "manifest has no stale entries");
  for (const file of Object.values(manifest.files)) assert.ok(existsSync(new URL(`../public/audio/practice/${file}`, import.meta.url)), file);
});

test("the collector covers examples, traps, quick checks, choose sentences and spot answers", () => {
  const phrases = new Set(collectFixedPracticePhrases(practiceLessons));
  for (const lesson of practiceLessons) {
    for (const rule of lesson.rules) {
      if (rule.right) assert.ok(phrases.has(rule.right.trim()), rule.id);
      for (const example of rule.examples) assert.ok(phrases.has(example.en.trim()), example.en);
      for (const trap of rule.traps) assert.ok(phrases.has(trap.right.trim()), trap.right);
    }
    for (const exercise of lesson.exercises) {
      const spoken = exercise.kind === "choose" ? exercise.sentence.replace("___", exercise.answer) : exercise.answer;
      assert.ok(phrases.has(spoken.trim()), exercise.id);
    }
  }
});
