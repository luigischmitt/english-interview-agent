import assert from "node:assert/strict";
import test from "node:test";
import { plannedQuestionType, remainingPlannedQuestions, resolveSpeculativeFixedSelection, selectNextPlannedQuestion, selectNextPlannedQuestions } from "../src/lib/interview/question-scheduling.mjs";

const questions = [
  { id: "introduction", prompt: "Introduction?", cue: "" },
  { id: "job-1", prompt: "How did you use Playwright?", cue: "" },
  { id: "job-2", prompt: "How did you test APIs?", cue: "" },
  { id: "ownership", prompt: "Tell me about ownership?", cue: "" },
  { id: "job-3", prompt: "How did CI run your tests?", cue: "" },
  { id: "conflict", prompt: "Tell me about a conflict?", cue: "" },
];

test("keeps a vacancy question even when its topic appeared in an earlier answer", () => {
  const askedQuestionIds = new Set(["introduction"]);
  const plan = selectNextPlannedQuestion({ questions, askedQuestionIds, elapsedSeconds: 60, durationMinutes: 5 });
  assert.equal(plan.question?.id, "job-1");
  assert.deepEqual(plan.remaining.map((question) => question.id), ["job-1", "job-2", "job-3", "ownership", "conflict"]);
});

test("an index jump cannot discard earlier unasked questions", () => {
  const askedQuestionIds = new Set(["introduction", "job-3"]);
  assert.deepEqual(remainingPlannedQuestions(questions, askedQuestionIds).map((question) => question.id), ["job-1", "job-2", "ownership", "conflict"]);
});

test("vacancy questions stay ahead of generic bank questions", () => {
  const plan = selectNextPlannedQuestion({ questions, askedQuestionIds: ["introduction", "job-1"], elapsedSeconds: 120, durationMinutes: 5 });
  assert.equal(plan.question?.id, "job-2");
  assert.equal(plan.index, 2);
});

test("prepares the next two planned questions without skipping job questions", () => {
  const prepared = selectNextPlannedQuestions({ questions, askedQuestionIds: ["introduction"], elapsedSeconds: 120, durationMinutes: 5 });
  assert.deepEqual(prepared.map((question) => question.id), ["job-1", "job-2"]);
});

test("prepares nothing inside the final reserve", () => {
  const prepared = selectNextPlannedQuestions({ questions, askedQuestionIds: ["introduction"], elapsedSeconds: 271, durationMinutes: 5 });
  assert.deepEqual(prepared, []);
});

test("starts a new question with exactly 30 seconds left, but not with 29", () => {
  const input = { questions, askedQuestionIds: ["introduction"], durationMinutes: 5 };
  assert.equal(selectNextPlannedQuestion({ ...input, elapsedSeconds: 270 }).question?.id, "job-1");
  assert.equal(selectNextPlannedQuestion({ ...input, elapsedSeconds: 271 }).question, null);
});

test("a resume opener that covered a project skips the next resume prompt and advances with its own ID", () => {
  const resumeQuestions = [
    { id: "introduction", prompt: "Could you introduce yourself?", cue: "" },
    { id: "resume-1", prompt: "Describe a project you built.", cue: "" },
    { id: "resume-2", prompt: "How did you improve its reliability?", cue: "" },
    { id: "resume-3", prompt: "What tradeoff did you make?", cue: "" },
    { id: "ownership", prompt: "Tell me about ownership.", cue: "" },
  ];
  const planned = selectNextPlannedQuestions({ questions: resumeQuestions, askedQuestionIds: ["introduction"], elapsedSeconds: 60, durationMinutes: 10 });
  const selection = resolveSpeculativeFixedSelection(planned, "SKIP");
  assert.equal(selection.question.id, "resume-2");
  assert.deepEqual(selection.skippedQuestionIds, ["resume-1"]);
  const asked = new Set(["introduction", ...selection.skippedQuestionIds, selection.question.id]);
  const next = selectNextPlannedQuestion({ questions: resumeQuestions, askedQuestionIds: asked, elapsedSeconds: 120, durationMinutes: 10 });
  assert.equal(next.question.id, "resume-3");
});

test("speculative fixed questions distinguish resume, job, and bank; job questions cannot be skipped", () => {
  assert.equal(plannedQuestionType({ id: "resume-2" }), "resume");
  assert.equal(plannedQuestionType({ id: "job-2" }), "job");
  assert.equal(plannedQuestionType({ id: "ownership" }), "bank");
  const jobFirst = resolveSpeculativeFixedSelection([
    { id: "job-1", prompt: "Role question?", cue: "" },
    { id: "ownership", prompt: "Bank question?", cue: "" },
  ], "SKIP");
  assert.equal(jobFirst.question.id, "job-1");
  assert.deepEqual(jobFirst.skippedQuestionIds, []);
});
