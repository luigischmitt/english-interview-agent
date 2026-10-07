import test from "node:test";
import assert from "node:assert/strict";
import { buildInterviewReportRequest } from "../src/lib/interview/report-request.mjs";

const direction = {
  targetRole: "Backend Engineer",
  suggestedSeniority: "mid-level",
  mainInterviewEmphasis: "Reliability in production.",
  priorityCompetencies: ["resilience", "observability"],
  productTeamContext: "A platform team.",
};
const config = {
  role: "Backend Engineer", seniority: "mid-level", focus: "technical-depth", duration: "15",
  questionCount: "5", playInterviewerAudio: false, showQuestionCaptions: true,
  candidateCameraEnabled: false, autoCaptureVoice: true,
};

test("all report stages carry the exact approved direction snapshot and role context", () => {
  const data = { turns: [{ sequenceNumber: 1, question: "How?", answer: "This." }] };
  const result = buildInterviewReportRequest({ ...config, jobDirection: direction }, data);
  assert.deepEqual(result, {
    ...data,
    roleContext: { targetRole: config.role, seniority: config.seniority, focus: config.focus },
    jobDirection: direction,
  });
  assert.equal(result.jobDirection, direction);
});

test("sessions without a valid matching snapshot keep the legacy payload shape", () => {
  const legacy = buildInterviewReportRequest(config, { turn: { sequenceNumber: 1, question: "How?", answer: "This." } });
  assert.deepEqual(legacy, {
    turn: { sequenceNumber: 1, question: "How?", answer: "This." },
    roleContext: { targetRole: config.role, seniority: config.seniority, focus: config.focus },
  });
  assert.deepEqual(buildInterviewReportRequest({ ...config, jobDirection: { ...direction, suggestedSeniority: "senior" } }, {}), {
    roleContext: { targetRole: config.role, seniority: config.seniority, focus: config.focus },
  });
});

test("resume reports use the asked questions and answers without vacancy framing", () => {
  const data = { turns: [{ sequenceNumber: 1, question: "What did you build?", answer: "I built an API." }] };
  const result = buildInterviewReportRequest({ ...config, interviewSource: "resume", jobDirection: direction }, data);
  assert.equal("jobDirection" in result, false);
  assert.deepEqual(result.roleContext, { targetRole: config.role, seniority: config.seniority, focus: config.focus });
});
