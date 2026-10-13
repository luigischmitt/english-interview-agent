import assert from "node:assert/strict";
import test from "node:test";
import { checkFixedAnswer, lessonRulesForRequest, pickPracticeRound, practiceLessonByKey, practiceLessons, practiceRuleById, ruleTextForRequest } from "../src/lib/practice/practice-lessons.mjs";
import { practiceCategoryKeys } from "../src/lib/practice/practice-categories.mjs";

test("every group is a small chapter: overview, rules with why, traps and translated examples", () => {
  assert.deepEqual(practiceLessons.map((lesson) => lesson.key), practiceCategoryKeys);
  const ids = practiceLessons.flatMap((lesson) => lesson.rules.map((rule) => rule.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const lesson of practiceLessons) {
    assert.equal("outcome" in lesson, false, `${lesson.key} has no outcome anymore`);
    const { what, why, model, map } = lesson.overview;
    for (const [name, text] of Object.entries({ what, why, model })) assert.ok(text.length >= 60, `${lesson.key} overview.${name}`);
    assert.equal(map.length, lesson.rules.length, `${lesson.key} map has one line per rule`);
    assert.ok(map.every((line) => line.length >= 15), `${lesson.key} map lines`);
    assert.ok(lesson.rules.length >= 3 && lesson.rules.length <= 7, lesson.key);
    for (const rule of lesson.rules) {
      assert.ok(rule.id.startsWith(`${lesson.key}.`), rule.id);
      assert.ok(rule.goal.length >= 45, `${rule.id} goal`);
      assert.ok(rule.pattern.length >= 12, `${rule.id} pattern`);
      assert.ok(rule.points.length >= 3 && rule.points.length <= 4, `${rule.id} key points`);
      assert.ok(rule.points.every((point) => point.length >= 20), `${rule.id} key point detail`);
      assert.ok(rule.explain.length >= 80 && rule.explain.length <= 420, `${rule.id} explain length`);
      assert.ok(rule.why && rule.why.length >= 40, `${rule.id} why`);
      if (rule.build) assert.ok(rule.build.length >= 2 && rule.build.length <= 4, `${rule.id} build steps`);
      assert.ok(rule.wrong && rule.right && rule.wrong !== rule.right, `${rule.id} contrast`);
      assert.ok(rule.examples.length >= 3 && rule.examples.length <= 4, `${rule.id} examples`);
      assert.ok(rule.examples.every((example) => example.en && example.pt), `${rule.id} examples need a translation`);
      assert.ok(rule.traps.length >= 1 && rule.traps.length <= 4, `${rule.id} traps`);
      for (const trap of rule.traps) {
        assert.ok(trap.wrong && trap.right && trap.note, `${rule.id} trap fields`);
        assert.notEqual(trap.wrong, trap.right, `${rule.id} trap must change something`);
      }
    }
  }
});

test("verb form lessons teach reusable rules instead of one isolated sentence", () => {
  const infinitive = practiceRuleById["verb-forms.to"];
  const thirdPerson = practiceRuleById["verb-forms.s"];
  const irregular = practiceRuleById["verb-forms.irregular"];
  assert.match(infinitive.points.join(" "), /need.*want.*plan.*decide/iu);
  assert.match(thirdPerson.pattern, /he\/she\/it/iu);
  assert.match(thirdPerson.points.join(" "), /does\/doesn't/iu);
  for (const family of ["build → built", "lead → led", "choose → chose", "write → wrote", "run → ran", "go → went"]) {
    assert.ok(irregular.points.join(" ").includes(family), family);
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
  assert.ok(lessonRulesForRequest("articles").length === 4);
});

const storedRuleIds = [
  "prepositions.at", "prepositions.on", "prepositions.in", "prepositions.for", "prepositions.to", "prepositions.combos", "articles.a-an",
  "articles.the", "articles.none", "verb-tenses.past", "verb-tenses.perfect", "verb-tenses.present", "verb-tenses.future", "verb-forms.to",
  "verb-forms.ing", "verb-forms.s", "verb-forms.irregular", "word-choice.actually", "word-choice.pretend", "word-choice.realize",
  "word-choice.eventually", "word-choice.do-make", "sentence-structure.subject", "sentence-structure.order", "sentence-structure.short",
  "sentence-structure.connectors", "plural-agreement.plural", "plural-agreement.verb", "plural-agreement.uncountable", "other.clarify", "other.time",
  "other.natural",
];
const storedExerciseIds = [
  "prepositions.c1", "prepositions.c2", "prepositions.c3", "prepositions.c4", "prepositions.c5", "prepositions.c6", "prepositions.s1",
  "prepositions.s2", "prepositions.s3", "prepositions.s4", "articles.c1", "articles.c2", "articles.c3", "articles.c4", "articles.c5", "articles.s1",
  "articles.s2", "articles.s3", "verb-tenses.c1", "verb-tenses.c2", "verb-tenses.c3", "verb-tenses.c4", "verb-tenses.c5", "verb-tenses.s1",
  "verb-tenses.s2", "verb-tenses.s3", "verb-tenses.s4", "verb-forms.c1", "verb-forms.c2", "verb-forms.c3", "verb-forms.c4", "verb-forms.c5",
  "verb-forms.c6", "verb-forms.s1", "verb-forms.s2", "verb-forms.s3", "word-choice.c1", "word-choice.c2", "word-choice.c3", "word-choice.c4",
  "word-choice.c5", "word-choice.c6", "word-choice.s1", "word-choice.s2", "word-choice.s3", "sentence-structure.c1", "sentence-structure.c2",
  "sentence-structure.c3", "sentence-structure.c4", "sentence-structure.s1", "sentence-structure.s2", "sentence-structure.s3", "plural-agreement.c1",
  "plural-agreement.c2", "plural-agreement.c3", "plural-agreement.c4", "plural-agreement.s1", "plural-agreement.s2", "plural-agreement.s3",
  "other.c1", "other.c2", "other.c3", "other.s1", "other.s2",
];

test("ids already stored in users' data still exist", () => {
  for (const id of storedRuleIds) assert.ok(practiceRuleById[id], id);
  const exerciseIds = new Set(practiceLessons.flatMap((lesson) => lesson.exercises.map((exercise) => exercise.id)));
  for (const id of storedExerciseIds) assert.ok(exerciseIds.has(id), id);
});

test("exercises belong to a rule of their own lesson and every rule has at least two choose and one spot", () => {
  const all = new Set();
  for (const lesson of practiceLessons) {
    const ruleIds = new Set(lesson.rules.map((rule) => rule.id));
    for (const exercise of lesson.exercises) {
      assert.ok(ruleIds.has(exercise.ruleId), `${exercise.id} points to a rule of ${lesson.key}`);
      assert.ok(!all.has(exercise.id), `${exercise.id} is unique across lessons`);
      all.add(exercise.id);
      if (exercise.kind === "choose") assert.equal(exercise.sentence.split("___").length, 2, `${exercise.id} has exactly one blank`);
    }
    for (const rule of lesson.rules) {
      const own = lesson.exercises.filter((exercise) => exercise.ruleId === rule.id);
      if (storedRuleIds.includes(rule.id)) continue;
      assert.ok(own.filter((exercise) => exercise.kind === "choose").length >= 2, `${rule.id} needs two choose`);
      assert.ok(own.filter((exercise) => exercise.kind === "spot").length >= 1, `${rule.id} needs a spot`);
    }
  }
});

test("the team is on the team: no lesson text teaches the wrong preposition", () => {
  assert.equal(JSON.stringify(practiceLessons).toLowerCase().includes("in the team"), false);
});

test("the other lesson is the interview phrases chapter", () => {
  assert.equal(practiceLessonByKey.other.title, "Frases de entrevista");
  for (const id of ["other.clarify", "other.time", "other.structure", "other.gap", "other.close"]) assert.ok(practiceRuleById[id], id);
});

test("every lesson still fills a round of five with three choose", () => {
  for (const lesson of practiceLessons) {
    for (const random of [() => 0.1, () => 0.5, Math.random]) {
      const round = pickPracticeRound({ key: lesson.key, random });
      assert.equal(round.length, 5, lesson.key);
      assert.equal(new Set(round.map((exercise) => exercise.id)).size, 5, lesson.key);
    }
  }
});
