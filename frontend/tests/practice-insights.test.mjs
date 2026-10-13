import test from "node:test";
import assert from "node:assert/strict";
import { lessonStats, relativeErrorDate, topLessons, topParts } from "../src/lib/practice/practice-insights.mjs";

const lessons = [
  { key: "a", rules: [{ id: "r1", label: "Articles" }, { id: "r2", label: "Prepositions" }], exercises: [] },
  { key: "b", rules: [{ id: "r3", label: "Verb tense" }], exercises: [] },
];
const ref = (interview_id, created_at, ruleId, extra = {}) => ({ interview_id, created_at, ruleId, ...extra });

test("lessonStats counts errors and interviews, ranks by count then recency, and counts top parts", () => {
  const groups = [
    { theme_key: "a", error_refs: [
      ref("a1", "2026-01-01", "r1"),
      ref("a2", "2026-02-01", "r1"),
      ref("a2", "2026-02-02", "r2"),
    ] },
    { theme_key: "b", error_refs: [ref("b1", "2026-03-01", "r3"), ref("b2", "2026-03-02", "r3"), ref("b3", "2026-03-03", "r3")] },
  ];
  const stats = lessonStats(groups, lessons);
  assert.deepEqual(stats.map(({ errors, interviews, rank, lastErrorAt }) => ({ errors, interviews, rank, lastErrorAt })), [
    { errors: 3, interviews: 2, rank: 2, lastErrorAt: "2026-02-02" },
    { errors: 3, interviews: 3, rank: 1, lastErrorAt: "2026-03-03" },
  ]);
  assert.deepEqual(stats[0].topParts.map(({ ruleId, count }) => ({ ruleId, count })), [{ ruleId: "r1", count: 2 }, { ruleId: "r2", count: 1 }]);
});

test("lessonStats classifies trend up, down, steady, and null before four interviews", () => {
  const trend = (counts) => {
    const refs = counts.flatMap((count, index) => Array.from({ length: count }, (_, item) => ref(`i${index}`, `2026-0${index + 1}-${item + 1}`, "r1")));
    return lessonStats([{ theme_key: "a", error_refs: refs }], lessons)[0].trend;
  };
  assert.equal(trend([1, 1, 2, 2]), "up");
  assert.equal(trend([2, 2, 1, 1, 1]), "down");
  assert.equal(trend([1, 1, 1, 1]), "steady");
  assert.equal(trend([1, 1, 1]), null);
});

test("topParts orders across lessons and returns the latest sentence", () => {
  const groups = [
    { theme_key: "a", error_refs: [
      ref("a1", "2026-01-01", "r1", { evidence: "old", rephrased: "old fix" }),
      ref("a2", "2026-02-01", "r1", { evidence: "new", rephrased: "new fix" }),
      ref("a3", "2026-03-01", "r2", { evidence: "preposition", rephrased: "fixed" }),
    ] },
    { theme_key: "b", error_refs: [ref("b1", "2026-04-01", "r3", { evidence: "tense", rephrased: "fixed tense" })] },
  ];
  const parts = topParts(groups, lessons, 3);
  assert.deepEqual(parts.map((part) => [part.lessonKey, part.ruleId, part.count]), [["a", "r1", 2], ["b", "r3", 1], ["a", "r2", 1]]);
  assert.deepEqual(parts[0].latest, { evidence: "new", rephrased: "new fix" });
});

test("topLessons includes unknown-rule mistakes and their latest correction", () => {
  const groups = [
    { theme_key: "a", error_refs: [ref("a1", "2026-01-01", undefined, { evidence: "old", rephrased: "old fix" }), ref("a2", "2026-02-01", undefined, { evidence: "latest", rephrased: "fixed" })] },
    { theme_key: "b", error_refs: [ref("b1", "2026-03-01", undefined)] },
  ];
  assert.deepEqual(topLessons(groups, lessons, 1), [{ lessonKey: "a", count: 2, interviews: 2, latest: { evidence: "latest", rephrased: "fixed" } }]);
});

test("relativeErrorDate uses today, yesterday, days, and month labels", () => {
  const now = new Date("2026-10-13T12:00:00.000Z");
  const date = (days) => new Date(now.getTime() - days * 86400000).toISOString();
  assert.equal(relativeErrorDate(date(0), now), "hoje");
  assert.equal(relativeErrorDate(date(1), now), "ontem");
  assert.equal(relativeErrorDate(date(2), now), "há 2 dias");
  assert.equal(relativeErrorDate(date(29), now), "há 29 dias");
  assert.equal(relativeErrorDate(date(30), now), "há 1 mês");
  assert.equal(relativeErrorDate(date(90), now), "há 3 meses");
});
