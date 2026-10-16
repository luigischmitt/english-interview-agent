import assert from "node:assert/strict";
import test from "node:test";
import { buildInterviewStudyPlanPayload, normalizeInterviewStudyPlan, requestInterviewStudyPlan, serializeInterviewAnalysis } from "../src/lib/interview/study-plan.mjs";

const config = {
  role: "Backend Engineer",
  seniority: "mid-level",
  focus: "technical-depth",
  interviewSource: "job",
  jobDirection: {
    targetRole: "Backend Engineer",
    suggestedSeniority: "mid-level",
    mainInterviewEmphasis: "Reliable APIs",
    priorityCompetencies: ["API design"],
    productTeamContext: "A payments team",
  },
};
const planTarget = {
  category: "ENGLISH_COMMUNICATION",
  lessonKey: "prepositions",
  ruleId: "prepositions.at",
  explanation: "Use the correct preposition after this verb.",
  why: "The current phrase changes the relationship between the service and its data.",
  sourceEvidence: "We discussed about the database.",
  correctedTarget: "We discussed the database.",
  acceptedAnswers: ["We discussed the database.", "We talked about the database."],
};
const report = {
  locale: "pt-BR",
  model: "hidden-model-name",
  analysisVersion: "v2",
  transcript: "private transcript must never be sent",
  englishCommunication: { patterns: [
    { type: "GRAMMAR", evidence: "She work in the team.", rephrasedExample: "She works on the team.", suggestion: "drop this" },
    { type: "OTHER", evidence: "discard this", rephrasedExample: "discard this" },
    { type: "WORD_CHOICE", evidence: "I pretend to fix it.", rephrasedExample: "I intend to fix it." },
  ] },
  technicalContent: { gaps: [
    { sequenceNumber: 3, evidence: "We discussed about the database.", explanation: "Explain the compatibility trade-off.", vacancyCompetency: "API design" },
    { sequenceNumber: 5, evidence: "", explanation: "This incomplete item is dropped." },
  ] },
  priorities: [],
};

test("study-plan request contains only role context, approved direction, and validated report evidence", () => {
  const payload = buildInterviewStudyPlanPayload(config, report);
  assert.deepEqual(Object.keys(payload).sort(), ["jobDirection", "patterns", "roleContext", "technicalGaps"].sort());
  assert.deepEqual(payload.patterns, [
    { type: "GRAMMAR", evidence: "She work in the team.", rephrasedExample: "She works on the team." },
    { type: "WORD_CHOICE", evidence: "I pretend to fix it.", rephrasedExample: "I intend to fix it." },
  ]);
  assert.deepEqual(payload.technicalGaps, [{ evidence: "We discussed about the database.", explanation: "Explain the compatibility trade-off.", vacancyCompetency: "API design" }]);
  assert.equal(JSON.stringify(payload).includes("private transcript"), false);
  assert.equal(JSON.stringify(payload).includes("sequenceNumber"), false);
  assert.equal(JSON.stringify(payload).includes("suggestion"), false);
});

test("study-plan request caps technical gaps at the backend's eight-item limit", () => {
  const gaps = Array.from({ length: 12 }, (_, index) => ({
    sequenceNumber: index + 1,
    evidence: `Evidence ${index + 1}`,
    explanation: `Gap ${index + 1}`,
  }));
  const payload = buildInterviewStudyPlanPayload(config, { ...report, technicalContent: { gaps } });
  assert.equal(payload.technicalGaps.length, 8);
  assert.equal(payload.technicalGaps.at(-1).evidence, "Evidence 8");
});

test("study-plan response accepts only a bounded complete targets list", () => {
  assert.deepEqual(normalizeInterviewStudyPlan({ targets: [planTarget] }), { targets: [planTarget] });
  assert.deepEqual(normalizeInterviewStudyPlan({ targets: [] }), { targets: [] });
  assert.equal(normalizeInterviewStudyPlan(null), null);
  assert.equal(normalizeInterviewStudyPlan({ targets: Array(4).fill(planTarget) }), null);
  assert.equal(normalizeInterviewStudyPlan({ targets: [{ ...planTarget, acceptedAnswers: [] }] }), null);
  assert.equal(normalizeInterviewStudyPlan({ targets: [{ ...planTarget, category: "TECHNICAL_CONTENT" }] }), null);
});

test("study-plan request is made once and failures return null without retry", async () => {
  let calls = 0;
  let request;
  const success = await requestInterviewStudyPlan(config, report, async (url, options) => {
    calls += 1;
    request = { url, options };
    return { ok: true, json: async () => ({ targets: [planTarget] }) };
  }, "https://backend.example");
  assert.deepEqual(success, { targets: [planTarget] });
  assert.equal(calls, 1);
  assert.equal(request.url, "https://backend.example/api/v1/thinking/study-plan");
  assert.equal(request.options.method, "POST");
  assert.ok(request.options.signal instanceof AbortSignal);

  calls = 0;
  const failed = await requestInterviewStudyPlan(config, report, async () => {
    calls += 1;
    throw new Error("network unavailable");
  });
  assert.equal(failed, null);
  assert.equal(calls, 1);
});

test("study-plan skips HTTP and returns an empty local plan without eligible English patterns", async () => {
  let calls = 0;
  const result = await requestInterviewStudyPlan(config, {
    ...report,
    englishCommunication: { patterns: [{ type: "NOT_A_PATTERN", evidence: "ignored", rephrasedExample: "ignored" }] },
  }, async () => { calls += 1; throw new Error("must not be called"); });
  assert.deepEqual(result, { targets: [] });
  assert.equal(calls, 0);
});

test("persisted report allowlist retains optional plan and technical-topic snapshot", () => {
  const studyPlan = { targets: [planTarget] };
  const serialized = serializeInterviewAnalysis({
    ...report,
    studyPlan,
    technicalQuestionTopics: [{ sequenceNumber: 3, topicId: "api-design" }],
  });
  assert.deepEqual(serialized.studyPlan, studyPlan);
  assert.deepEqual(serialized.technicalQuestionTopics, [{ sequenceNumber: 3, topicId: "api-design" }]);
  assert.equal("transcript" in serialized, false);
  assert.equal("model" in serialized, false);
});

test("persisted report allowlist ignores retired polished answers", () => {
  const polishedAnswers = { 3: { polishedAnswer: "I led the migration.", keyChanges: [], generatedAt: "2026-01-01T00:00:00.000Z" } };
  assert.equal("polishedAnswers" in serializeInterviewAnalysis({ ...report, polishedAnswers }), false);
});

test("persisted report allowlist retains per-answer turns while legacy reports remain valid", () => {
  const turn = { sequenceNumber: 2, technicalStrengths: [], technicalGaps: [], englishPatterns: [] };
  assert.deepEqual(serializeInterviewAnalysis({ ...report, turns: [turn] }).turns, [turn]);
  assert.equal("turns" in serializeInterviewAnalysis(report), false);
});

test("report serializer persists qualitative overview and ignores legacy redo data", () => {
  const serialized = serializeInterviewAnalysis({ ...report, overview: { technical: "Good technical explanation.", english: "Clear phrasing." }, redos: { 1: [{ transcript: "legacy" }] } });
  assert.deepEqual(serialized.overview, { technical: "Good technical explanation.", english: "Clear phrasing." });
  assert.equal("redos" in serialized, false);
});
