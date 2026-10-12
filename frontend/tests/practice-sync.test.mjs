import test from "node:test";
import assert from "node:assert/strict";
import { applyPracticeResult, findMissingErrors, mergeRefs, sortThemes } from "../src/lib/practice/practice-sync.mjs";
const ref = (evidence, interview_id = "i1") => ({ interview_id, sequence_number: 1, evidence });
test("finds errors absent from all theme refs and caps recent items at twenty", () => { const errors = Array.from({ length: 25 }, (_, i) => ({ ...ref(String(i)), created_at: new Date(i * 1000).toISOString() })); assert.equal(findMissingErrors(errors, [{ error_refs: [ref("0")] }]).length, 20); assert.equal(findMissingErrors(errors, [{ error_refs: [ref("0")] }])[0].evidence, "24"); });
test("merges refs by identity", () => assert.equal(mergeRefs([ref("a")], [ref("a"), ref("b")]).length, 2));
test("mastery requires three consecutive correct answers", () => { assert.deepEqual(applyPracticeResult({ correct_streak: 2, status: "active" }, "correct"), { correct_streak: 3, status: "mastered" }); assert.deepEqual(applyPracticeResult({ correct_streak: 2, status: "active" }, "almost"), { correct_streak: 0, status: "active" }); });
test("orders active themes before mastered themes", () => { assert.deepEqual(sortThemes([{ theme_key:"m",status:"mastered",weighted_frequency:8,last_error_at:null },{theme_key:"a",status:"active",weighted_frequency:1,last_error_at:null}]).map(x=>x.theme_key), ["a","m"]); });
