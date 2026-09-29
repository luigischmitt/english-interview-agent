import { describe, expect, it } from "vitest";

import { evaluateInterviewReportProviderOutput, type InterviewReportParseResult } from "../src/thinking/openrouter-interview-report-service.js";
import type { InterviewReport } from "../src/thinking/types.js";
import { interviewReportEvalFixtures, type InterviewReportEvalExpected } from "./fixtures/interview-report-eval.js";

type ValidExpected = Extract<InterviewReportEvalExpected, { result: "valid" }>;

function matchesExpectedSemantics(
  report: InterviewReport,
  diagnostics: InterviewReportParseResult["diagnostics"],
  expected: ValidExpected,
): boolean {
  const noForbiddenGapExplanation = expected.forbiddenGapExplanations?.every((claim) =>
    !report.technicalContent.gaps.some((gap) => gap.explanation.toLocaleLowerCase("pt-BR").includes(claim.toLocaleLowerCase("pt-BR")))
  ) ?? true;
  return report.technicalContent.summary === expected.summary
    && expected.forbiddenSummaryClaims.every((claim) => !report.technicalContent.summary.toLocaleLowerCase("pt-BR").includes(claim.toLocaleLowerCase("pt-BR")))
    && noForbiddenGapExplanation
    && JSON.stringify(report.technicalContent.strengths) === JSON.stringify(expected.strengths)
    && JSON.stringify(report.technicalContent.gaps) === JSON.stringify(expected.gaps)
    && JSON.stringify(report.englishCommunication.patterns) === JSON.stringify(expected.patterns)
    && report.englishCommunication.evidenceStatus === expected.evidenceStatus
    && JSON.stringify(report.priorities) === JSON.stringify(expected.priorities)
    && diagnostics.optionalItems.candidates === expected.optionalItems.candidates
    && diagnostics.optionalItems.accepted === expected.optionalItems.accepted
    && diagnostics.optionalItems.rejected === expected.optionalItems.rejected;
}

function evaluateFixture(fixture: (typeof interviewReportEvalFixtures)[number]): InterviewReportParseResult {
  const rawModelOutput = typeof fixture.providerOutput === "string"
    ? fixture.providerOutput
    : JSON.stringify(fixture.providerOutput);
  return evaluateInterviewReportProviderOutput(rawModelOutput, fixture.input);
}

describe("offline synthetic final-report evaluation fixtures", () => {
  for (const fixture of interviewReportEvalFixtures) {
    it(fixture.name, () => {
      const result = evaluateFixture(fixture);
      expect(Object.keys(result.diagnostics)).toEqual(["providerOutput", "optionalItems"]);
      expect(Object.keys(result.diagnostics.optionalItems)).toEqual(["candidates", "accepted", "rejected", "rejectionReasons"]);

      if (fixture.expected.result === "invalid") {
        expect(result.report).toBeNull();
        expect(result.diagnostics.providerOutput).toBe("invalid");
        expect(result.diagnostics.optionalItems).toEqual({ candidates: 0, accepted: 0, rejected: 0, rejectionReasons: { mismatch: 0, invalidFormat: 0, artifact: 0, duplicate: 0, limit: 0 } });
        return;
      }

      expect(result.report).not.toBeNull();
      if (!result.report) throw new Error("Expected a parsed report for this fixture.");
      expect(result.diagnostics.providerOutput).toBe("valid");
      expect(Object.values(result.diagnostics.optionalItems.rejectionReasons).reduce((sum, count) => sum + count, 0)).toBe(result.diagnostics.optionalItems.rejected);
      expect(matchesExpectedSemantics(result.report, result.diagnostics, fixture.expected)).toBe(true);
    });
  }

  it("fails the semantic oracle for an invented claim and for evidence attributed to the wrong turn", () => {
    const toolMention = interviewReportEvalFixtures.find((fixture) => fixture.name.startsWith("tool mention"));
    const crossTurn = interviewReportEvalFixtures.find((fixture) => fixture.name.startsWith("cross-turn"));
    expect(toolMention).toBeDefined();
    expect(crossTurn).toBeDefined();
    if (!toolMention || !crossTurn || typeof toolMention.providerOutput === "string" || typeof crossTurn.providerOutput === "string") return;
    if (toolMention.expected.result !== "valid" || crossTurn.expected.result !== "valid") throw new Error("Expected valid semantic oracles.");

    const inventedOutput = {
      ...toolMention.providerOutput,
      technicalContent: {
        ...toolMention.providerOutput.technicalContent,
        summary: "A pessoa é especialista em AWS e reduziu custos com a plataforma.",
      },
    };
    const inventedResult = evaluateInterviewReportProviderOutput(JSON.stringify(inventedOutput), toolMention.input);
    expect(inventedResult.report).not.toBeNull();
    if (inventedResult.report) {
      expect(matchesExpectedSemantics(inventedResult.report, inventedResult.diagnostics, toolMention.expected)).toBe(false);
    }

    const wrongTurnOutput = {
      ...crossTurn.providerOutput,
      technicalContent: {
        ...crossTurn.providerOutput.technicalContent,
        strengths: [
          { sequenceNumber: 5, evidence: "added a cache with Redis", explanation: "Atribui ao segundo turno uma ação citada apenas no primeiro." },
        ],
      },
    };
    const wrongTurnResult = evaluateInterviewReportProviderOutput(JSON.stringify(wrongTurnOutput), crossTurn.input);
    expect(wrongTurnResult.report).not.toBeNull();
    if (wrongTurnResult.report) {
      expect(wrongTurnResult.report.technicalContent.strengths).toEqual([]);
      expect(wrongTurnResult.diagnostics.optionalItems).toMatchObject({ candidates: 1, accepted: 0, rejected: 1, rejectionReasons: { mismatch: 1 } });
      expect(matchesExpectedSemantics(wrongTurnResult.report, wrongTurnResult.diagnostics, crossTurn.expected)).toBe(false);
    }
  });

  it("marks a demand for optional checks in an open-ended migration question as a semantic failure", () => {
    const fixture = interviewReportEvalFixtures.find((item) => item.name.startsWith("report covers distinct isolated"));
    expect(fixture).toBeDefined();
    if (!fixture || typeof fixture.providerOutput === "string" || fixture.expected.result !== "valid") return;

    const tangentialGapOutput = {
      ...fixture.providerOutput,
      technicalContent: {
        ...fixture.providerOutput.technicalContent,
        gaps: [{ sequenceNumber: 2, evidence: "checked errors between them", explanation: "Não detalha critérios nem passos opcionais para a verificação." }],
      },
    };
    const result = evaluateInterviewReportProviderOutput(JSON.stringify(tangentialGapOutput), fixture.input);
    expect(result.report).not.toBeNull();
    if (result.report) expect(matchesExpectedSemantics(result.report, result.diagnostics, fixture.expected)).toBe(false);

    const unansweredSummaryOutput = {
      ...fixture.providerOutput,
      technicalContent: {
        ...fixture.providerOutput.technicalContent,
        summary: "A pessoa não abordou a migração, embora cite verificações e uma decisão concreta.",
      },
    };
    const summaryResult = evaluateInterviewReportProviderOutput(JSON.stringify(unansweredSummaryOutput), fixture.input);
    expect(summaryResult.report).not.toBeNull();
    if (summaryResult.report) expect(matchesExpectedSemantics(summaryResult.report, summaryResult.diagnostics, fixture.expected)).toBe(false);
  });

  it("distinguishes no model findings from model findings rejected as noise", () => {
    const noFinding = interviewReportEvalFixtures.find((fixture) => fixture.name.startsWith("legitimate absence"));
    const noisy = interviewReportEvalFixtures.find((fixture) => fixture.name.startsWith("transcription noise"));
    expect(noFinding).toBeDefined();
    expect(noisy).toBeDefined();
    if (!noFinding || !noisy) return;

    const noFindingResult = evaluateFixture(noFinding);
    const noisyResult = evaluateFixture(noisy);
    expect(noFindingResult.report?.englishCommunication.evidenceStatus).toBe("NO_PATTERN_FOUND");
    expect(noFindingResult.diagnostics.optionalItems.candidates).toBe(0);
    expect(noisyResult.report?.englishCommunication.evidenceStatus).toBe("LIMITED");
    expect(noisyResult.diagnostics.optionalItems).toMatchObject({ candidates: 3, accepted: 1, rejected: 2, rejectionReasons: { artifact: 2 } });
    expect(noisyResult.report?.evidenceReview?.englishPatterns).toMatchObject({ candidates: 3, accepted: 1, rejected: 2, rejectionReasons: { artifact: 2 } });
    expect(noisyResult.report?.evidenceReview?.technicalStrengths).toMatchObject({ candidates: 0, accepted: 0, rejected: 0 });
    const reasons = noisyResult.report?.evidenceReview?.englishPatterns.rejectionReasons;
    expect(reasons && Object.values(reasons).reduce((sum, count) => sum + count, 0)).toBe(noisyResult.report?.evidenceReview?.englishPatterns.rejected);
  });

  it("exposes only aggregate candidate, accepted, and rejected counts per category", () => {
    const fixture = interviewReportEvalFixtures.find((item) => item.name.startsWith("detailed answer"));
    expect(fixture).toBeDefined();
    if (!fixture) return;
    const result = evaluateFixture(fixture);
    expect(result.report?.evidenceReview).toMatchObject({
      technicalStrengths: { candidates: 1, accepted: 1, rejected: 0 },
      technicalGaps: { candidates: 1, accepted: 1, rejected: 0 },
      englishPatterns: { candidates: 0, accepted: 0, rejected: 0 },
      priorities: { candidates: 1, accepted: 1, rejected: 0 },
    });
  });

  it("distinguishes all rejected suggestions from an empty model list", () => {
    const allRejected = interviewReportEvalFixtures.find((fixture) => fixture.name.startsWith("all unsupported"));
    expect(allRejected).toBeDefined();
    if (!allRejected) return;
    const result = evaluateFixture(allRejected);
    expect(result.report?.englishCommunication.patterns).toEqual([]);
    expect(result.report?.englishCommunication.evidenceStatus).toBe("CANDIDATES_REJECTED");
    expect(result.report?.evidenceReview?.englishPatterns).toMatchObject({ candidates: 1, accepted: 0, rejected: 1, rejectionReasons: { mismatch: 1 } });
  });

  it("counts a duplicate separately and keeps the first accepted finding", () => {
    const duplicate = interviewReportEvalFixtures.find((fixture) => fixture.name.startsWith("duplicate findings"));
    expect(duplicate).toBeDefined();
    if (!duplicate) return;
    const result = evaluateFixture(duplicate);
    const counts = result.report?.evidenceReview?.englishPatterns;
    expect(result.report?.englishCommunication.patterns).toHaveLength(1);
    expect(counts).toMatchObject({ candidates: 2, accepted: 1, rejected: 1, rejectionReasons: { mismatch: 0, invalidFormat: 0, artifact: 0, duplicate: 1 } });
    expect(counts?.rejectionReasons && Object.values(counts.rejectionReasons).reduce((sum, count) => sum + count, 0)).toBe(counts?.rejected);
  });
});
