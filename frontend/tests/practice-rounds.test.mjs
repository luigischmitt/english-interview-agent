import test from "node:test";
import assert from "node:assert/strict";
import { buildRound, gradeLocally, requeueMissed } from "../src/lib/practice/practice-rounds.mjs";
import { lessonStats, topParts } from "../src/lib/practice/practice-insights.mjs";
import { practiceLessons } from "../src/lib/practice/practice-lessons.mjs";

const exercises = [
  ...Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, ruleId: i % 2 ? "r2" : "r1", kind: i % 3 ? "choose" : "spot", sentence: "I work in Google.", answer: i % 3 ? "at" : "I work at Google.", options: ["at", "in"], accepted: ["I am interested in machine learning."], why: null })),
];
const lessons = [{ key: "a", rules: [{ id: "r1", label: "on" }, { id: "r2", label: "in" }], exercises }, { key: "b", rules: [{ id: "r3", label: "at" }], exercises: exercises.map((x) => ({ ...x, id: `b-${x.id}`, ruleId: "r3" })) }];
const random = () => 0.5;

test("round mode sizes and rule scoped focused rounds", () => {
  assert.equal(buildRound({ mode: "quick", key: "a", lessons, random }).length, 5);
  for (const size of [10, 15, 20]) assert.equal(buildRound({ mode: "focused", key: "a", size, lessons, random }).length, size);
  const oneRule = buildRound({ mode: "focused", key: "a", ruleId: "r1", size: 20, lessons, random });
  assert.equal(oneRule.length, 6); assert.ok(oneRule.every((x) => x.ruleId === "r1"));
  const quickPart = buildRound({ mode: "quick", key: "a", ruleId: "r1", lessons, random });
  assert.equal(quickPart.length, 5);
  assert.ok(quickPart.every((item) => item.ruleId === "r1"));
  const shortPart = buildRound({ mode: "quick", key: "a", ruleId: "r1", lessons: [{ ...lessons[0], exercises: lessons[0].exercises.slice(0, 1) }], random });
  assert.equal(shortPart.length, 5);
  assert.ok(shortPart.every((item) => item.ruleId === "r1"));
});

test("insights rank lesson errors and expose each part's latest evidence", () => {
  const groups = [{ theme_key: "a", error_refs: [
    { interview_id: "i1", created_at: "2026-01-01", ruleId: "r1", evidence: "wrong", rephrased: "right" },
    { interview_id: "i2", created_at: "2026-02-01", ruleId: "r1", evidence: "wrong 2", rephrased: "right 2" },
    { interview_id: "i3", created_at: "2026-03-01", ruleId: "r2", evidence: "wrong 3", rephrased: "right 3" },
  ] }];
  const stats = lessonStats(groups, lessons);
  assert.equal(stats[0].errors, 3); assert.equal(stats[0].interviews, 3);
  assert.equal(stats[0].rank, 1);
  assert.equal(topParts(groups, lessons, 1)[0].latest.rephrased, "right 2");
  const trendRefs = [];
  for (let i = 1; i <= 5; i++) for (let j = 0; j < (i < 3 ? 1 : 2); j++) trendRefs.push({ interview_id: `t${i}`, created_at: `2026-0${i}-0${j + 1}`, ruleId: "r1" });
  assert.equal(lessonStats([{ theme_key: "a", error_refs: trendRefs }], lessons)[0].trend, "up");
});
test("weights, missed preference, mine scope and missed requeue", () => {
  assert.ok(buildRound({ mode: "quick", key: "a", lessons, weights: { r2: 100 }, random }).filter((x) => x.ruleId === "r2").length >= 3);
  assert.equal(buildRound({ mode: "quick", key: "a", lessons, missedIds: ["a0"], random })[0].id, "a0");
  assert.ok(buildRound({ mode: "mine", lessons, weights: { r1: 2, r3: 1 }, random }).every((x) => ["r1", "r3"].includes(x.ruleId)));
  assert.deepEqual(buildRound({ mode: "mine", lessons, random }), []);
  const round = exercises.slice(0, 3); const queued = requeueMissed(round, [{ verdict: "incorrect" }, { verdict: "correct" }, { verdict: "almost" }]);
  assert.deepEqual(queued.slice(3).map((x) => x.id), [round[0].id, round[2].id]);
});
test("local grading handles exact, contractions, punctuation, partial and unrelated answers", () => {
  const choose = { kind: "choose", sentence: "I work ___ Google.", answer: "at", options: ["at", "in"] };
  assert.equal(gradeLocally(choose, "at").verdict, "correct");
  assert.equal(gradeLocally(choose, "in").verdict, "incorrect");
  const spot = { kind: "spot", sentence: "I work in Google.", answer: "I work at Google.", accepted: ["I work at Google"] };
  assert.equal(gradeLocally(spot, "I work at Google.").verdict, "correct");
  assert.equal(gradeLocally(spot, "i work at google").verdict, "correct");
  assert.equal(gradeLocally({ ...spot, sentence: "I'm interested on ML.", answer: "I'm interested in ML." }, "I am interested in ML!").verdict, "correct");
  for (const [source, expected] of [["I don't", "I do not"], ["It's ready", "It is ready"], ["I've shipped it", "I have shipped it"], ["We're ready", "We are ready"], ["I didn't ship", "I did not ship"], ["It doesn't work", "It does not work"], ["I haven't shipped", "I have not shipped"], ["I can't ship", "I cannot ship"], ["I won't ship", "I will not ship"]]) {
    assert.equal(gradeLocally({ kind: "spot", sentence: `Yesterday ${source}`, answer: `Yesterday ${expected}` }, `Yesterday ${source}`).verdict, "incorrect");
    assert.equal(gradeLocally({ kind: "spot", sentence: `Earlier ${source}`, answer: `Yesterday ${expected}` }, `Yesterday ${source}`).verdict, "correct");
  }
  assert.equal(gradeLocally(spot, "I work at Google today.").verdict, "almost");
  assert.equal(gradeLocally(spot, "The weather is nice today.").verdict, "incorrect");
});

test("every real spot exercise accepts its answers and rejects its unchanged source", () => {
  const spots = practiceLessons.flatMap((lesson) => lesson.exercises).filter((exercise) => exercise.kind === "spot");
  assert.ok(spots.length > 0);
  for (const exercise of spots) {
    for (const answer of [exercise.answer, ...(exercise.accepted ?? [])]) {
      assert.equal(gradeLocally(exercise, answer).verdict, "correct", `${exercise.id}: ${answer}`);
    }
    assert.equal(gradeLocally(exercise, exercise.sentence).verdict, "incorrect", `${exercise.id}: unchanged source`);
  }
});

test("partial correction requires the changed region in context", () => {
  const grade = (sentence, answer, submission) => gradeLocally({ kind: "spot", sentence, answer }, submission).verdict;
  assert.equal(grade("I worked on project today.", "I worked on a project today.", "I worked on a project yesterday."), "almost");
  assert.equal(grade("I deployed patch today.", "I deployed today.", "Yesterday, I deployed today."), "almost");
  assert.equal(grade("I work in cloud today.", "I work on cloud today.", "I work on cloud today, thankfully."), "almost");
  assert.equal(grade("I worked on project for a bank.", "I worked on a project for a bank.", "I worked on project for a bank."), "incorrect");
});
