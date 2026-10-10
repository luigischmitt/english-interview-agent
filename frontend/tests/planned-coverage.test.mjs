import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannedCoverageStartFields, finalPlannedCoverage, recordPlannedCoverage, resolvePlannedCoveredSkip } from "../src/lib/interview/planned-coverage.mjs";

const resume = (n) => ({ id: `resume-${n}`, prompt: `Resume question ${n}?` });
const job = (n) => ({ id: `job-${n}`, prompt: `Job question ${n}?` });

test("start fields carry the planned question and at most three condensed earlier answers", () => {
  const long = "x ".repeat(400);
  const fields = buildPlannedCoverageStartFields({ plannedQuestion: " Which\nmetrics do you use? ", previousAnswers: ["a", "b", long, "d"] });
  assert.equal(fields.plannedQuestion, "Which metrics do you use?");
  assert.equal(fields.contextAnswers.length, 3);
  assert.deepEqual(fields.contextAnswers.slice(0, 1), ["b"]);
  assert.ok(fields.contextAnswers.every((answer) => answer.length <= 500));
  assert.ok(fields.contextAnswers[1].includes("…"));
});

test("start fields cap the planned question at 300 characters and omit empty input", () => {
  assert.ok(buildPlannedCoverageStartFields({ plannedQuestion: "word ".repeat(120) }).plannedQuestion.length <= 300);
  assert.deepEqual(buildPlannedCoverageStartFields({ plannedQuestion: "  " }), {});
  assert.deepEqual(buildPlannedCoverageStartFields({}), {});
  assert.deepEqual(buildPlannedCoverageStartFields({ plannedQuestion: "Why?" }), { plannedQuestion: "Why?" });
});

test("records only the current epoch and keeps COVERED sticky within it", () => {
  const map = new Map();
  assert.equal(recordPlannedCoverage(map, { speechEpoch: 0, coverage: "OPEN" }, 1), false);
  assert.equal(recordPlannedCoverage(map, { speechEpoch: 1, coverage: "MAYBE" }, 1), false);
  assert.equal(recordPlannedCoverage(map, { speechEpoch: 1, coverage: "PARTIAL" }, 1), true);
  assert.equal(recordPlannedCoverage(map, { speechEpoch: 1, coverage: "PARTIAL" }, 1), false);
  assert.equal(recordPlannedCoverage(map, { speechEpoch: 1, coverage: "COVERED" }, 1), true);
  assert.equal(recordPlannedCoverage(map, { speechEpoch: 1, coverage: "OPEN" }, 1), false);
  assert.equal(map.get(1), "COVERED");
});

test("final coverage: COVERED in any epoch is sticky; otherwise the final epoch, else the latest", () => {
  assert.equal(finalPlannedCoverage(new Map(), 0), undefined);
  assert.equal(finalPlannedCoverage(new Map([[0, "COVERED"], [1, "OPEN"]]), 1), "COVERED");
  assert.equal(finalPlannedCoverage(new Map([[0, "PARTIAL"], [1, "OPEN"]]), 1), "OPEN");
  assert.equal(finalPlannedCoverage(new Map([[0, "PARTIAL"], [1, "OPEN"]]), 2), "OPEN");
  assert.equal(finalPlannedCoverage(new Map([[0, "PARTIAL"], [2, "OPEN"]]), null), "OPEN");
});

test("skips only a COVERED, same, non-job question when another remains", () => {
  const candidates = [resume(1), resume(2), resume(3)];
  const base = { coverage: "COVERED", judgedQuestionId: "resume-1", selectedQuestionId: "resume-1", candidates };
  assert.deepEqual(resolvePlannedCoveredSkip(base), { replacement: resume(2), skippedQuestionId: "resume-1" });
  for (const coverage of ["PARTIAL", "OPEN", undefined]) assert.equal(resolvePlannedCoveredSkip({ ...base, coverage }), null);
  assert.equal(resolvePlannedCoveredSkip({ ...base, judgedQuestionId: "resume-2" }), null);
  assert.equal(resolvePlannedCoveredSkip({ ...base, selectedQuestionId: "resume-2" }), null);
  assert.equal(resolvePlannedCoveredSkip({ ...base, candidates: [resume(1)] }), null);
  assert.equal(resolvePlannedCoveredSkip({ ...base, candidates: [] }), null);
});

test("never skips a job question and never lands on an excluded one", () => {
  const jobCandidates = [job(1), resume(2)];
  assert.equal(resolvePlannedCoveredSkip({ coverage: "COVERED", judgedQuestionId: "job-1", selectedQuestionId: "job-1", candidates: jobCandidates }), null);
  const result = resolvePlannedCoveredSkip({ coverage: "COVERED", judgedQuestionId: "resume-1", selectedQuestionId: "resume-1", candidates: [resume(1), resume(2), resume(3)], excludedIds: ["resume-2"] });
  assert.equal(result.replacement.id, "resume-3");
  const replacementJob = resolvePlannedCoveredSkip({ coverage: "COVERED", judgedQuestionId: "resume-1", selectedQuestionId: "resume-1", candidates: [resume(1), job(1)] });
  assert.equal(replacementJob.replacement.id, "job-1");
});
