import test from "node:test";
import assert from "node:assert/strict";
import { applyPracticeResult, completedLegacyThemeIds, extractProgressErrors, findPracticeSyncWork, mergeRefs, recencyWeight, sortPracticeGroups, weightedFrequency } from "../src/lib/practice/practice-sync.mjs";

const ref = (evidence, interview_id = "i1") => ({ interview_id, sequence_number: 1, evidence });

test("extracts errors from progress records", () => {
  const records = [{
    id: "i1",
    createdAt: "2025-01-01",
    patterns: [{
      sequenceNumber: 2,
      evidence: "I have 5 years",
      rephrasedExample: "I have five years",
    }],
  }];
  const errors = extractProgressErrors(records);
  assert.deepEqual(errors[0], {
    interview_id: "i1",
    sequence_number: 2,
    evidence: "I have 5 years",
    rephrased: "I have five years",
    type: undefined,
    suggestion: undefined,
    created_at: "2025-01-01",
  });
});

test("sync work excludes saved group refs and keeps the twenty newest", () => {
  const errors = Array.from({ length: 25 }, (_, index) => ({ ...ref(String(index)), created_at: new Date(index * 1000).toISOString() }));
  const missing = findPracticeSyncWork(errors, [{ id: "g", theme_key: "articles", error_refs: [ref("0")] }]);
  assert.equal(missing.length, 20);
  assert.equal(missing[0].evidence, "24");
});

test("reclassifies legacy refs once and combines them with new errors in bounded work", () => {
  const legacyRef = { ...ref("legacy"), rephrased: "Better", created_at: "2025-01-01" };
  const groupRef = { ...ref("already grouped"), point: "Artigos", category: "articles" };
  const themes = [
    { id: "old", theme_key: "old-topic", error_refs: [legacyRef] },
    { id: "articles", theme_key: "articles", error_refs: [groupRef] },
  ];
  const errors = [legacyRef, ref("new")];
  assert.deepEqual(findPracticeSyncWork(errors, themes).map((item) => item.evidence), ["legacy", "new"]);
  assert.deepEqual(completedLegacyThemeIds(themes), []);
  assert.deepEqual(completedLegacyThemeIds([...themes, { id: "ignored", theme_key: "_ignored", error_refs: [legacyRef] }]), ["old"]);
  assert.equal(findPracticeSyncWork(errors, [...themes, { id: "ignored", theme_key: "_ignored", error_refs: [legacyRef] }])[0].evidence, "new");
});

test("merges refs by identity and keeps the newest 200 (the table limit)", () => {
  assert.equal(mergeRefs([ref("a")], [ref("a"), ref("b")]).length, 2);
  assert.equal(mergeRefs([], Array.from({ length: 205 }, (_, index) => ref(String(index)))).length, 200);
  assert.deepEqual(mergeRefs([], [
    { ...ref("newer"), created_at: "2025-02-01" },
    { ...ref("older"), created_at: "2025-01-01" },
  ]).map((item) => item.evidence), ["older", "newer"]);
});

test("recency weighting stays finite when dates are absent or invalid", () => {
  assert.equal(recencyWeight({ ...ref("missing") }, null, 1_000), 1);
  assert.equal(Number.isFinite(weightedFrequency([{ ...ref("invalid"), created_at: "bad" }], "bad", 1_000)), true);
  assert.ok(recencyWeight({ ...ref("old"), created_at: new Date(0).toISOString() }, null, 30 * 86_400_000) < 1);
});

test("mastery requires three consecutive correct answers", () => {
  assert.deepEqual(applyPracticeResult({ correct_streak: 2, status: "active" }, "correct"), { correct_streak: 3, status: "mastered" });
  assert.deepEqual(applyPracticeResult({ correct_streak: 2, status: "active" }, "almost"), { correct_streak: 0, status: "active" });
});

test("orders active themes before mastered themes", () => {
  const themes = [
    { theme_key: "articles", status: "mastered", weighted_frequency: 8, last_error_at: null, error_refs: [ref("m")] },
    { theme_key: "prepositions", status: "active", weighted_frequency: 1, last_error_at: null, error_refs: [ref("a")] },
    { theme_key: "legacy", status: "active", weighted_frequency: 99, last_error_at: null, error_refs: [ref("old")] },
  ];
  assert.deepEqual(sortPracticeGroups(themes).map((theme) => theme.theme_key), ["prepositions", "articles"]);
});
