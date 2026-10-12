import test from "node:test";
import assert from "node:assert/strict";
import { normalizePracticeAnswer, practiceCategories, practiceCategoryKeys } from "../src/lib/practice/practice-categories.mjs";

test("defines the fixed practice groups in product order with three examples each", () => {
  assert.deepEqual(practiceCategoryKeys, ["prepositions", "articles", "verb-tenses", "verb-forms", "word-choice", "sentence-structure", "plural-agreement", "other"]);
  assert.equal(practiceCategories.length, 8);
  for (const category of practiceCategories) {
    assert.ok(category.title && category.explanation && category.why);
    assert.equal(category.examples.length, 3);
  }
});

test("normalizes punctuation, capitalization, and repeated whitespace", () => {
  assert.equal(normalizePracticeAnswer("  The API, works!  "), "the api works");
});
