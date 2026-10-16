import test from "node:test";
import assert from "node:assert/strict";
import { buildPronunciationInsights } from "../src/lib/interview/pronunciation-insights.mjs";

const phrase = (phraseIndex, text, problemWords = [], issue = "pronunciation") => ({ phraseIndex, text, startMs: 0, endMs: 900, score: 70, issue, problemWords });
const word = (word, worstPhoneme) => ({ word, score: 50, errorType: "Mispronunciation", worstPhoneme, prosodyErrors: [] });
const record = (id, date, phrases, sequenceNumber = 1) => ({ id, createdAt: date, completedAt: date, feedback: { azureSummary: { answers: [{ sequenceNumber, phrases }] } } });

test("groups recurring words by sound family, with intonation evidence", () => {
  const result = buildPronunciationInsights([
    record("one", "2026-01-01", [phrase(0, "think about it", [word("think", "th"), word("about", "ax")]), phrase(1, "I used it", [], "intonation")]),
    record("two", "2026-02-01", [phrase(0, "this is right", [word("this", "dh"), word("right", "r")])]),
  ]);
  assert.deepEqual(result.families.map(({ id, count }) => [id, count]), [["th", 2], ["intonation", 1], ["initialR", 1], ["schwa", 1]]);
  assert.deepEqual(result.families.find(({ id }) => id === "th").examples, ["this", "think"]);
});

test("orders newest first and limits visible phrase evidence to 20", () => {
  const old = record("old", "2025-12-01", [phrase(0, "old phrase", [word("worked", "t")])]);
  const recent = record("recent", "2026-03-01", Array.from({ length: 21 }, (_, index) => phrase(index, `phrase ${index}`, [word("ship", "ih")])));
  const result = buildPronunciationInsights([old, recent]);
  assert.equal(result.phrases.length, 20);
  assert.equal(result.phrases[0].text, "phrase 0");
  assert.equal(result.phrases.at(-1).text, "phrase 19");
  assert.equal(result.families[0].count, 21);
});

test("recognizes open vowels, aspirated h, final consonants, and the -ed ending", () => {
  const result = buildPronunciationInsights([record("one", "2026-01-01", [
    phrase(0, "cat", [word("cat", "ae")]),
    phrase(1, "cut", [word("cut", "ah")]),
    phrase(2, "hello", [word("hello", "hh")]),
    phrase(3, "worked", [word("worked", "t")]),
    phrase(4, "ship", [word("ship", "p")]),
  ])]);
  assert.deepEqual(result.families.map(({ id, count }) => [id, count]), [["openVowels", 2], ["final", 1], ["ed", 1], ["h", 1]]);
});

test("tolerates old rows without phrases and ignores legacy sentences", () => {
  const result = buildPronunciationInsights([{ id: "old", createdAt: "2026-01-01", feedback: { azureSummary: { answers: [{ sequenceNumber: 1, sentences: [{ text: "ignored" }] }] } } }]);
  assert.deepEqual(result, { families: [], phrases: [] });
});
