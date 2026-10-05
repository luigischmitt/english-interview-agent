import assert from "node:assert/strict";
import test from "node:test";
import { remainingPlannedQuestions, selectNextPlannedQuestion } from "../src/lib/interview/question-scheduling.mjs";

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

test("starts a new question with exactly 30 seconds left, but not with 29", () => {
  const input = { questions, askedQuestionIds: ["introduction"], durationMinutes: 5 };
  assert.equal(selectNextPlannedQuestion({ ...input, elapsedSeconds: 270 }).question?.id, "job-1");
  assert.equal(selectNextPlannedQuestion({ ...input, elapsedSeconds: 271 }).question, null);
});
