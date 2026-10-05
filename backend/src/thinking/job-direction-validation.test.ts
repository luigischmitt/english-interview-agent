import { describe, expect, it } from "vitest";
import { parseApprovedJobDirection } from "./job-direction-validation.js";

const base = {
  targetRole: "QA Analyst",
  suggestedSeniority: "mid-level",
  mainInterviewEmphasis: "Automação de testes.",
  priorityCompetencies: ["Playwright"],
  productTeamContext: "Contexto do time não informado na vaga.",
};
const question = "How would you structure a Playwright test suite so it stays reliable as the product grows?";

describe("approved job direction", () => {
  it("accepts snapshots with and without tailored questions but keeps them out of the prompt snapshot", () => {
    expect(parseApprovedJobDirection(base, "QA Analyst", "mid-level")).toEqual(base);
    expect(parseApprovedJobDirection({ ...base, tailoredQuestions: [question] }, "QA Analyst", "mid-level")).toEqual(base);
  });

  it.each([
    ["too many", [question, "What is flaky testing?", "How do you triage bugs?", "How do you use Postman collections?"]],
    ["empty", []],
    ["portuguese", ["Como você estrutura uma suíte de testes?"]],
    ["two question marks", ["How do you test? And why?"]],
    ["duplicates", [question, question]],
    ["not strings", [1]],
  ])("rejects invalid tailored questions (%s)", (_name, tailoredQuestions) => {
    expect(parseApprovedJobDirection({ ...base, tailoredQuestions }, "QA Analyst", "mid-level")).toBeNull();
  });

  it("still rejects unknown keys and missing required keys", () => {
    expect(parseApprovedJobDirection({ ...base, extra: "x" }, "QA Analyst", "mid-level")).toBeNull();
    const { productTeamContext: _omitted, ...missing } = base;
    expect(parseApprovedJobDirection(missing, "QA Analyst", "mid-level")).toBeNull();
  });
});
