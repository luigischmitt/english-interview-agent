import assert from "node:assert/strict";
import test from "node:test";
import { checkFixedAnswer, lessonRulesForRequest, pickPracticeRound, practiceLessonByKey, practiceLessons, practiceRuleById, ruleTextForRequest } from "../src/lib/practice/practice-lessons.mjs";
import { practiceCategoryKeys } from "../src/lib/practice/practice-categories.mjs";

test("every group has a didactic lesson: explanation, contrast and translated examples", () => {
  assert.deepEqual(practiceLessons.map((lesson) => lesson.key), practiceCategoryKeys);
  const ids = practiceLessons.flatMap((lesson) => lesson.rules.map((rule) => rule.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const lesson of practiceLessons) {
    assert.ok(lesson.rules.length >= 3 && lesson.rules.length <= 6, lesson.key);
    for (const rule of lesson.rules) {
      assert.ok(rule.id.startsWith(`${lesson.key}.`), rule.id);
      assert.ok(rule.explain.length >= 80 && rule.explain.length <= 420, `${rule.id} explain length`);
      assert.ok(rule.wrong && rule.right && rule.wrong !== rule.right, `${rule.id} contrast`);
      assert.equal(rule.examples.length, 2, rule.id);
      assert.ok(rule.examples.every((example) => example.en && example.pt), `${rule.id} examples need a translation`);
    }
  }
});

test("fixed exercises are consistent: known rules, the right option is offered, spot sentences really change", () => {
  for (const lesson of practiceLessons) {
    assert.ok(lesson.exercises.length >= 5, lesson.key);
    const ids = new Set();
    for (const exercise of lesson.exercises) {
      assert.ok(!ids.has(exercise.id), exercise.id);
      ids.add(exercise.id);
      assert.ok(practiceRuleById[exercise.ruleId], `${exercise.id} rule`);
      assert.ok(exercise.why, exercise.id);
      if (exercise.kind === "choose") {
        assert.ok(exercise.sentence.includes("___"), exercise.id);
        assert.ok(exercise.options.includes(exercise.answer), exercise.id);
        assert.equal(new Set(exercise.options).size, exercise.options.length, exercise.id);
      } else {
        assert.equal(exercise.kind, "spot", exercise.id);
        assert.equal(checkFixedAnswer(exercise, exercise.sentence), false, `${exercise.id} must contain a mistake`);
        assert.equal(checkFixedAnswer(exercise, exercise.answer), true, exercise.id);
      }
    }
  }
});

test("local check ignores case and punctuation and accepts listed variants", () => {
  const exercise = practiceLessonByKey["verb-tenses"].exercises.find((item) => item.id === "verb-tenses.s1");
  assert.equal(checkFixedAnswer(exercise, "i've worked with python for five years"), true);
  assert.equal(checkFixedAnswer(exercise, "I work with Python for five years."), false);
  assert.equal(checkFixedAnswer(exercise, ""), false);
});

test("a round puts own sentences first, then fresh fixed exercises across different rules", () => {
  let seed = 0.1;
  const random = () => (seed = (seed * 9301 + 0.49297) % 1);
  const round = pickPracticeRound({ key: "prepositions", ownErrors: [{ evidence: "I worked in the project", rephrased: "I worked on the project" }], ownCount: 1, recentIds: ["prepositions.c1"], random });
  assert.equal(round.length, 5);
  assert.equal(round[0].kind, "fix");
  assert.equal(round[0].answer, "I worked on the project");
  const fixed = round.slice(1);
  assert.equal(new Set(fixed.map((exercise) => exercise.ruleId)).size, fixed.length);
  assert.ok(!fixed.some((exercise) => exercise.id === "prepositions.c1"));
  assert.ok(fixed.some((exercise) => exercise.kind === "choose") && fixed.some((exercise) => exercise.kind === "spot"));
});

test("by default a round has only fixed exercises: three choose and two spot", () => {
  for (const lesson of practiceLessons) {
    const round = pickPracticeRound({ key: lesson.key, ownErrors: [{ evidence: "x", rephrased: "y" }] });
    assert.equal(round.length, 5, lesson.key);
    assert.ok(round.every((exercise) => exercise.kind !== "fix"), lesson.key);
    assert.equal(round.filter((exercise) => exercise.kind === "choose").length, 3, lesson.key);
  }
});

test("rule text for grading is compact", () => {
  assert.ok(ruleTextForRequest("prepositions.on").startsWith("on: "));
  assert.ok(ruleTextForRequest("prepositions.on").length <= 240);
  assert.equal(ruleTextForRequest("missing"), null);
  assert.ok(lessonRulesForRequest("articles").length === 3);
});
