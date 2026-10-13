import test from "node:test";
import assert from "node:assert/strict";
import { parsePracticeLink, practiceLink } from "../src/lib/practice/practice-links.mjs";
import { practiceLessons } from "../src/lib/practice/practice-lessons.mjs";

test("practiceLink builds the Treinar deep link", () => {
  assert.equal(practiceLink("articles"), "/dashboard?view=train&lesson=articles");
  assert.equal(practiceLink("articles", "articles.a"), "/dashboard?view=train&lesson=articles&part=articles.a");
});

test("parsePracticeLink accepts known lessons and parts and ignores unknown ones", () => {
  const lesson = practiceLessons[0];
  const rule = lesson.rules[0];
  assert.deepEqual(parsePracticeLink(lesson.key, rule.id), { lesson: lesson.key, part: rule.id });
  assert.deepEqual(parsePracticeLink(lesson.key, "nope"), { lesson: lesson.key, part: null });
  assert.deepEqual(parsePracticeLink(lesson.key, undefined), { lesson: lesson.key, part: null });
  assert.equal(parsePracticeLink("nope", rule.id), null);
  assert.equal(parsePracticeLink("__proto__", null), null);
  assert.equal(parsePracticeLink(undefined, undefined), null);
});
