import assert from "node:assert/strict";
import test from "node:test";
import { buildLearnerQuestionProfile, createTechnicalQuestionSnapshot, personalizeTechnicalQuestions, reportTechnicalFocus } from "../src/lib/interview/personalization.mjs";
import { getFixedInterviewQuestions } from "../src/lib/interview/questions.ts";
import { getQuestionBankForRole } from "../src/lib/interview/question-bank.mjs";

const record = (id, targetRole, topicIds, completedAt = "2026-01-01T00:00:00.000Z") => ({
  id,
  status: "completed",
  targetRole,
  completedAt,
  feedback: {
    status: "ready",
    analysis: {
      technicalQuestionTopics: topicIds.map((topicId, index) => ({ sequenceNumber: index * 2 + 1, topicId })),
      technicalContent: { gaps: topicIds.map((_, index) => ({ sequenceNumber: index * 2 + 1, explanation: "Add a concrete technical example." })) },
    },
  },
});

test("profile counts recurring gaps once per completed interview and filters compatible roles", () => {
  const profile = buildLearnerQuestionProfile([
    record("a", "Backend Engineer", ["api-design", "reliability"]),
    record("b", "Backend Engineer", ["api-design"], "2026-02-01T00:00:00.000Z"),
    record("c", "Frontend Engineer", ["web-performance"]),
    record("d", "Backend Engineer", ["testing"]),
  ], "Backend Engineer");
  assert.deepEqual(profile.map(({ topicId, sessionCount }) => [topicId, sessionCount]), [["api-design", 2], ["reliability", 1], ["testing", 1]]);
});

test("legacy and malformed reports safely produce no profile", () => {
  const profile = buildLearnerQuestionProfile([
    { id: "legacy", status: "completed", targetRole: "Backend Engineer", feedback: { status: "ready", analysis: { technicalContent: { gaps: [{ sequenceNumber: 1, explanation: "A gap" }] } } } },
    { ...record("pending", "Backend Engineer", ["api-design"]), status: "in_progress" },
    null,
    { id: "bad", status: "completed", targetRole: "Backend Engineer", feedback: { status: "ready", analysis: { technicalQuestionTopics: "bad", technicalContent: { gaps: [] } } } },
  ], "Backend Engineer");
  assert.deepEqual(profile, []);
});

test("question selection is stable, uses no more than two alternates, and falls back without history", () => {
  const config = { role: "Software Engineer", seniority: "mid-level" };
  const original = getFixedInterviewQuestions(config);
  assert.deepEqual(getFixedInterviewQuestions(config, []), original);
  const profile = ["technical-debt", "performance", "debugging"].map((topicId) => ({ topicId, sessionCount: 2 }));
  const first = getFixedInterviewQuestions(config, profile);
  const second = getFixedInterviewQuestions(config, profile);
  assert.deepEqual(first, second);
  assert.equal(first.filter((question) => question.id.endsWith("-alternate")).length, 2);
  assert.equal(first[2].topicId, "debugging");
  assert.equal(first.find((question) => question.topicId === "performance").id, "performance-alternate");
  assert.deepEqual(personalizeTechnicalQuestions(original, profile, { seniority: "junior" }), original);
});

test("resume and vacancy tailored prompts remain ahead of and untouched by personalization", () => {
  const tailoredQuestions = Array.from({ length: 3 }, (_, index) => `How would you validate a test plan for feature ${index + 1}?`);
  const config = {
    role: "QA Analyst",
    seniority: "mid-level",
    jobDirection: {
      targetRole: "QA Analyst",
      suggestedSeniority: "mid-level",
      mainInterviewEmphasis: "Testing",
      priorityCompetencies: ["Automation"],
      productTeamContext: "A product team",
      tailoredQuestions,
    },
  };
  const questions = getFixedInterviewQuestions(config, [{ topicId: "frontend-testing", sessionCount: 4 }, { topicId: "testing", sessionCount: 3 }]);
  assert.deepEqual(questions.slice(1, 4).map((question) => question.prompt), tailoredQuestions);
  assert.ok(questions.every((question) => !question.prompt.startsWith("How do you choose which parts of a system")));
  assert.equal(questions.length, 15);
  assert.equal(getFixedInterviewQuestions({ ...config, interviewSource: "resume" }, [{ topicId: "testing", sessionCount: 3 }])[1].id, "resume-1");
});

test("snapshots include only exact stable prompts; report focus is hidden for legacy data and counts prior sessions", () => {
  const questions = getQuestionBankForRole("Backend Engineer");
  const question = questions.find((item) => item.id === "api-design");
  const snapshot = createTechnicalQuestionSnapshot(questions, [
    { sequenceNumber: 3, question: question.prompt },
    { sequenceNumber: 5, question: "An adapted version of the question?" },
  ]);
  assert.deepEqual(snapshot, [{ sequenceNumber: 3, topicId: "api-design" }]);
  const report = {
    technicalContent: { gaps: [{ sequenceNumber: 3, explanation: "Explain the compatibility plan." }] },
    technicalQuestionTopics: snapshot,
  };
  assert.deepEqual(reportTechnicalFocus(report, [record("old", "Backend Engineer", ["api-design"])], "Backend Engineer", "current"), {
    focus: "Explain the compatibility plan.",
    priorSessionCount: 1,
  });
  assert.equal(reportTechnicalFocus({ technicalContent: report.technicalContent }, [], "Backend Engineer"), null);
});
