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
  return report.technicalContent.summary === expected.summary
    && expected.forbiddenSummaryClaims.every((claim) => !report.technicalContent.summary.toLocaleLowerCase("pt-BR").includes(claim.toLocaleLowerCase("pt-BR")))
    && JSON.stringify(report.technicalContent.strengths) === JSON.stringify(expected.strengths)
    && JSON.stringify(report.technicalContent.gaps) === JSON.stringify(expected.gaps)
    && JSON.stringify(report.englishCommunication.patterns) === JSON.stringify(expected.patterns)
    && report.englishCommunication.evidenceStatus === expected.evidenceStatus
    && JSON.stringify(report.priorities) === JSON.stringify(expected.priorities)
    && JSON.stringify(diagnostics.optionalItems) === JSON.stringify(expected.optionalItems);
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
      expect(Object.keys(result.diagnostics.optionalItems)).toEqual(["candidates", "accepted", "rejected"]);

      if (fixture.expected.result === "invalid") {
        expect(result.report).toBeNull();
        expect(result.diagnostics.providerOutput).toBe("invalid");
        expect(result.diagnostics.optionalItems).toEqual({ candidates: 0, accepted: 0, rejected: 0 });
        return;
      }

      expect(result.report).not.toBeNull();
      if (!result.report) throw new Error("Expected a parsed report for this fixture.");
      expect(result.diagnostics.providerOutput).toBe("valid");
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
      expect(wrongTurnResult.diagnostics.optionalItems).toEqual({ candidates: 1, accepted: 0, rejected: 1 });
      expect(matchesExpectedSemantics(wrongTurnResult.report, wrongTurnResult.diagnostics, crossTurn.expected)).toBe(false);
    }
  });

  it("distinguishes no model findings from model findings rejected as noise", () => {
    const noFinding = interviewReportEvalFixtures.find((fixture) => fixture.name.startsWith("legitimate absence"));
    const noisy = interviewReportEvalFixtures.find((fixture) => fixture.name.startsWith("transcription noise"));
    expect(noFinding).toBeDefined();
    expect(noisy).toBeDefined();
    if (!noFinding || !noisy) return;

    const noFindingResult = evaluateFixture(noFinding);
    const noisyResult = evaluateFixture(noisy);
    expect(noFindingResult.report?.englishCommunication.evidenceStatus).toBe("INSUFFICIENT");
    expect(noFindingResult.diagnostics.optionalItems).toEqual({ candidates: 0, accepted: 0, rejected: 0 });
    expect(noisyResult.report?.englishCommunication.evidenceStatus).toBe("LIMITED");
    expect(noisyResult.diagnostics.optionalItems).toEqual({ candidates: 3, accepted: 1, rejected: 2 });
  });
});
