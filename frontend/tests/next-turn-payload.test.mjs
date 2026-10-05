import assert from "node:assert/strict";
import test from "node:test";
import { serializeNextTurnRequest } from "../src/lib/interview/next-turn-payload.mjs";

test("next-turn serialization includes the approved direction and excludes the source description", () => {
  const direction = {
    targetRole: "Backend Engineer", suggestedSeniority: "mid-level", mainInterviewEmphasis: "Reliable API design",
    priorityCompetencies: ["comunicação interpessoal"], productTeamContext: "Equipe de pagamentos",
  };
  const serialized = serializeNextTurnRequest({
    config: {
      role: "Backend Engineer", seniority: "mid-level", focus: "technical-depth", jobDirection: direction,
      jobDescription: "PRIVATE_RAW_JOB_DESCRIPTION_SENTINEL",
    },
    currentQuestion: "What experience would help you in this role?", transcript: "I built APIs for payments.",
    nextFixedQuestion: "How would you keep an API reliable?", remainingFixedQuestions: ["How would you keep an API reliable?"],
    followUpUsed: false, askedQuestions: [],
  });
  const payload = JSON.parse(serialized);
  assert.deepEqual(payload.jobDirection, direction);
  assert.deepEqual(payload.roleContext, { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" });
  assert.equal(serialized.includes("PRIVATE_RAW_JOB_DESCRIPTION_SENTINEL"), false);
});

test("next-turn serialization bounds future questions and history while keeping the end of answers", () => {
  const answer = `${"old ".repeat(100)}LAST_ANSWER_DETAIL`;
  const payload = JSON.parse(serializeNextTurnRequest({
    config: { role: "Backend Engineer", seniority: "senior", focus: "technical-depth" },
    currentQuestion: "Current question?", transcript: "Current answer.", nextFixedQuestion: "Question 1?",
    remainingFixedQuestions: Array.from({ length: 8 }, (_, index) => `Question ${index + 1}?`),
    followUpUsed: false,
    askedQuestions: ["A".repeat(200), "Short question?"],
    previousAnswers: [
      { question: "Old 1?", answer: "Old 1." },
      { question: "Old 2?", answer: "Old 2." },
      { question: "Most recent?", answer },
    ],
  }));
  assert.deepEqual(payload.remainingFixedQuestions, ["Question 1?", "Question 2?", "Question 3?", "Question 4?"]);
  assert.equal(payload.askedQuestions[0].length, 160);
  assert.equal(payload.askedQuestions[1], "Short question?");
  assert.equal(payload.previousAnswers.length, 2);
  assert.equal(payload.previousAnswers[1].answer.length, 300);
  assert.equal(payload.previousAnswers[1].answer.endsWith("LAST_ANSWER_DETAIL"), true);
});
