import test from "node:test";
import assert from "node:assert/strict";
import prepositions from "../src/lib/practice/context/prepositions.json" with { type: "json" };
import articles from "../src/lib/practice/context/articles.json" with { type: "json" };
import verbTenses from "../src/lib/practice/context/verb-tenses.json" with { type: "json" };
import verbForms from "../src/lib/practice/context/verb-forms.json" with { type: "json" };
import wordChoice from "../src/lib/practice/context/word-choice.json" with { type: "json" };
import sentenceStructure from "../src/lib/practice/context/sentence-structure.json" with { type: "json" };
import pluralAgreement from "../src/lib/practice/context/plural-agreement.json" with { type: "json" };
import other from "../src/lib/practice/context/other.json" with { type: "json" };
import { practiceLessons } from "../src/lib/practice/practice-lessons.mjs";

const contextByLesson = { prepositions, articles, "verb-tenses": verbTenses, "verb-forms": verbForms, "word-choice": wordChoice, "sentence-structure": sentenceStructure, "plural-agreement": pluralAgreement, other };
const commonPortuguese = new Set(["a", "an", "and", "as", "at", "be", "by", "do", "for", "from", "has", "have", "he", "in", "is", "it", "me", "no", "of", "on", "or", "our", "she", "that", "the", "their", "there", "this", "to", "was", "we", "were", "with", "you"]);

test("every practice exercise has concise, distinct situational context and meaning", () => {
  const pairs = new Set();
  for (const lesson of practiceLessons) {
    const data = contextByLesson[lesson.key];
    const exercises = new Map(lesson.exercises.map((exercise) => [exercise.id, exercise]));
    for (const id of Object.keys(data)) assert.ok(exercises.has(id), `${lesson.key}: unknown exercise id ${id}`);
    for (const exercise of lesson.exercises) {
      const item = data[exercise.id];
      assert.ok(item, `${lesson.key}/${exercise.id}: missing context data`);
      assert.equal(typeof item.context, "string", `${exercise.id}: context must be a string`);
      assert.equal(typeof item.meaning, "string", `${exercise.id}: meaning must be a string`);
      assert.equal(item.context, item.context.trim(), `${exercise.id}: context must be trimmed`);
      assert.equal(item.meaning, item.meaning.trim(), `${exercise.id}: meaning must be trimmed`);
      assert.ok(item.context.length <= 110, `${exercise.id}: context exceeds 110 characters`);
      assert.ok(item.meaning.length <= 120, `${exercise.id}: meaning exceeds 120 characters`);
      const pair = `${item.context}\u0000${item.meaning}`;
      assert.ok(!pairs.has(pair), `${exercise.id}: context and meaning pair is duplicated`);
      pairs.add(pair);
      const answer = exercise.answer.toLocaleLowerCase("en-US");
      if (/^[a-z]+$/u.test(answer) && !commonPortuguese.has(answer)) {
        assert.doesNotMatch(item.meaning, new RegExp(`\\b${answer}\\b`, "iu"), `${exercise.id}: meaning contains the English answer`);
      }
    }
  }
});
