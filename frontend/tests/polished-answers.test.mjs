import test from "node:test";
import assert from "node:assert/strict";
import { mergeAnsweredQuestions, mergeSavedPolishedAnswers, pairAnsweredQuestions } from "../src/lib/interview/polished-answers-data.mjs";

test("pairs question turns with candidate answers and ignores unpaired/empty turns", () => {
  assert.deepEqual(pairAnsweredQuestions([
    { sequenceNumber: 2, speaker: "candidate", content: "I built an API." },
    { sequenceNumber: 1, speaker: "interviewer", content: "Tell me about a project?" },
    { sequenceNumber: 3, speaker: "interviewer", content: "What was hard?" },
  ]), [{ sequenceNumber: 1, question: "Tell me about a project?", answer: "I built an API." }]);
});

test("deduplicates questions newest-first and attaches saved versions", () => {
  const records = [
    { id: "old", target_role: "Engineer", created_at: "2026-01-01", completed_at: "2026-01-01", analysis: { polishedAnswers: { 1: { polishedAnswer: "Old" } } } },
    { id: "new", target_role: "Engineer", created_at: "2026-02-01", completed_at: "2026-02-01", analysis: { polishedAnswers: { 1: { polishedAnswer: "New" } } } },
  ];
  const turns = new Map([
    ["old", [{ sequenceNumber: 1, speaker: "interviewer", content: "Tell me about a project?" }, { sequenceNumber: 2, speaker: "candidate", content: "old answer" }]],
    ["new", [{ sequenceNumber: 1, speaker: "interviewer", content: "Tell me about a project?" }, { sequenceNumber: 2, speaker: "candidate", content: "new answer" }]],
  ]);
  assert.deepEqual(mergeAnsweredQuestions(records, turns).map(({ interviewId, answer, polishedAnswer }) => ({ interviewId, answer, polishedAnswer })), [{ interviewId: "new", answer: "new answer", polishedAnswer: { polishedAnswer: "New" } }]);
});

test("merges saved answer without replacing other analysis fields", () => {
  assert.deepEqual(mergeSavedPolishedAnswers({ priorities: ["clarity"], polishedAnswers: { 1: "prior" } }, 2, "saved"), { priorities: ["clarity"], polishedAnswers: { 1: "prior", 2: "saved" } });
});
