import assert from "node:assert/strict";
import test from "node:test";
import { buildHomeInsights } from "../src/lib/interview/home-insights.mjs";

const metric = (mean, totalDurationMs = 30_000) => ({ mean, sampleCount: 2, totalDurationMs });
const record = (id, completedAt, analysis = null, azureSummary = null) => ({
  id,
  status: "completed",
  targetRole: "Backend Engineer",
  focus: null,
  seniority: "Senior",
  startedAt: completedAt,
  completedAt,
  createdAt: completedAt,
  answerCount: 4,
  feedback: { status: "ready", analysis, azureSummary },
});

test("summarizes only persisted home information from the latest completed interview", () => {
  const older = record("older", "2026-01-10T10:00:00.000Z", { summary: "Resumo antigo." });
  const latest = record("latest", "2026-02-10T10:00:00.000Z", {
    interviewerTakeaway: { remember: "Você conectou a decisão técnica ao impacto." },
    englishCommunication: {
      clarity: "CLEAR",
      evidenceStatus: "SUFFICIENT",
      patterns: [{ type: "GRAMMAR", sequenceNumber: 1, evidence: "he go", suggestion: "Use goes", rephrasedExample: "He goes" }],
    },
  }, {
    accuracy: metric(82),
    fluency: metric(68),
    prosody: metric(74),
  });

  const result = buildHomeInsights([older, latest]);
  assert.equal(result.interviewCount, 2);
  assert.equal(result.lastInterviewAt, latest.completedAt);
  assert.equal(result.lastReportReady, true);
  assert.equal(result.lastTakeaway, "Você conectou a decisão técnica ao impacto.");
  assert.deepEqual(result.topPattern, { type: "Gramática", suggestion: "Use goes" });
  assert.deepEqual(result.voiceFocus, {
    label: "Ritmo",
    value: 68,
    measure: "Mostra a fluidez entre palavras e pausas; não é velocidade de fala.",
  });
});

test("keeps the first-practice state empty and does not manufacture voice data", () => {
  assert.deepEqual(buildHomeInsights([]), {
    interviewCount: 0,
    lastInterviewAt: null,
    lastReportReady: false,
    lastTakeaway: null,
    topPattern: null,
    voiceFocus: null,
  });
});
