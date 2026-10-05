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
