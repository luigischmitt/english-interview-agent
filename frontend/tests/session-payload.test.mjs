import assert from "node:assert/strict";
import test from "node:test";
import { buildInterviewSessionPayload } from "../src/lib/interview/session-payload.mjs";

const direction = {
  targetRole: "Backend Engineer",
  suggestedSeniority: "mid-level",
  mainInterviewEmphasis: "Reliable API design",
  priorityCompetencies: ["API reliability", "Incident response"],
  productTeamContext: "A payments product team",
};
const config = {
  role: "Backend Engineer", seniority: "mid-level", focus: "reliability", duration: "15", questionCount: "8",
  jobDirection: direction,
  jobDescription: "PRIVATE_RAW_JOB_DESCRIPTION_SENTINEL",
};

test("session payload stores only the approved direction snapshot, never raw job description", () => {
  const payload = buildInterviewSessionPayload(config, "user-1", "2026-10-05T00:00:00.000Z");
  assert.deepEqual(payload, {
    user_id: "user-1", target_role: "Backend Engineer", seniority: "mid-level", focus: "reliability",
    job_direction: direction, duration_minutes: 15, question_count: 8, status: "in_progress", started_at: "2026-10-05T00:00:00.000Z",
  });
  assert.equal(JSON.stringify(payload).includes("PRIVATE_RAW_JOB_DESCRIPTION_SENTINEL"), false);
});

test("invalid or mismatched direction is omitted for backward-compatible generic sessions", () => {
  const withoutDirection = buildInterviewSessionPayload({ ...config, jobDirection: undefined }, "user-1", "now");
  const mismatched = buildInterviewSessionPayload({ ...config, jobDirection: { ...direction, targetRole: "Frontend Engineer" } }, "user-1", "now");
  assert.equal(Object.hasOwn(withoutDirection, "job_direction"), false);
  assert.equal(Object.hasOwn(mismatched, "job_direction"), false);
});

test("tailored questions stay out of the stored direction (the asked questions are saved as turns)", () => {
  const tailoredQuestions = ["How would you keep a Playwright suite reliable as the product grows?"];
  const payload = buildInterviewSessionPayload({ ...config, jobDirection: { ...direction, tailoredQuestions } }, "user-1", "now");
  assert.equal(Object.hasOwn(payload.job_direction, "tailoredQuestions"), false);
});

test("resume sessions do not persist a vacancy-style direction", () => {
  const payload = buildInterviewSessionPayload({ ...config, interviewSource: "resume" }, "user-1", "now");
  assert.equal(Object.hasOwn(payload, "job_direction"), false);
});

test("resume sessions save a neutral label instead of the inferred role, seniority and focus", () => {
  const payload = buildInterviewSessionPayload({ ...config, interviewSource: "resume" }, "user-1", "now");
  assert.equal(payload.target_role, "Prática pelo currículo");
  assert.equal(payload.seniority, null);
  assert.equal(payload.focus, null);
  const job = buildInterviewSessionPayload({ ...config, interviewSource: "job" }, "user-1", "now");
  assert.deepEqual([job.target_role, job.seniority, job.focus], ["Backend Engineer", "mid-level", "reliability"]);
});
