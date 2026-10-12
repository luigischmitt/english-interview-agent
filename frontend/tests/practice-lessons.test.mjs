import assert from "node:assert/strict";
import test from "node:test";
import { lessonRulesForRequest, practiceLessonByKey, practiceLessons, practiceRuleById } from "../src/lib/practice/practice-lessons.mjs";
import { practiceCategoryKeys } from "../src/lib/practice/practice-categories.mjs";

test("every practice group has a short lesson with unique, prefixed rule ids", () => {
  assert.deepEqual(practiceLessons.map((lesson) => lesson.key), practiceCategoryKeys);
  const ids = practiceLessons.flatMap((lesson) => lesson.rules.map((rule) => rule.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const lesson of practiceLessons) {
    assert.ok(lesson.rules.length >= 3 && lesson.rules.length <= 6, lesson.key);
    for (const rule of lesson.rules) {
      assert.ok(rule.id.startsWith(`${lesson.key}.`), rule.id);
      assert.ok(rule.when.length <= 110, rule.id);
      assert.equal(rule.examples.length, 2, rule.id);
      assert.ok(rule.examples.every((example) => example.length <= 70), rule.id);
    }
  }
});

test("rules for a request are compact and resolvable by id", () => {
  const rules = lessonRulesForRequest("prepositions");
  assert.ok(rules.length > 0);
  assert.equal(practiceRuleById[rules[0].id].label, "at");
  assert.deepEqual(lessonRulesForRequest("unknown"), []);
  assert.equal(practiceLessonByKey.articles.subtitle, "a, an, the");
});
