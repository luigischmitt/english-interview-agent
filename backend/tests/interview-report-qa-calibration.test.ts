import { describe, expect, it } from "vitest";

import { evaluateInterviewReportProviderOutput } from "../src/thinking/openrouter-interview-report-service.js";
import type { InterviewReportInput } from "../src/thinking/types.js";

/** Fourth real Whisper-transcribed report (QA Analyst, mid-level): a contraction "fixed", a wrong correction, a mis-heard acronym. */
const roleContext = { targetRole: "QA Analyst", seniority: "mid-level", focus: "technical-depth" };
const turns: InterviewReportInput["turns"] = [
  { sequenceNumber: 1, question: "Which part of your experience would be most valuable in this position?", answer: "So, um, so is when I started to develop an assistance and Studio of this world. I've been... working and building many projects and using CI/CD workflow, checks and Get GitHub for all of my projects, all of my works, and with this is a part of my work that is most available for this position" },
  { sequenceNumber: 3, question: "What kind of CI/CD workflows did you use in your projects?", answer: "So I use JCI CG for... for do tax and Fork. can... see If my new... If my new rose and my new... your updates will break my website or will break any area of my work. and Yeah, and I think that's for it that I use CINCD." },
  { sequenceNumber: 5, question: "Can you describe a project you owned from start to finish, including your part and the result?", answer: "So, I'm working in a project to build... a framework to access synthetic images And I am in this. I am in this framework using the GLCM and that is a tool uh which can return to me the energy and the contrast of images." },
  { sequenceNumber: 7, question: "How did you implement the GLCM tool in your framework?", answer: "so I implemented the GLCM Mmm... You should a model nodaly in Python and this nodaly is a model. And this is a model nodaly in Python. have the This is Sarah Kogge. to use the gelsm." },
];
const patternsOf = (patterns: unknown[]) => evaluateInterviewReportProviderOutput(JSON.stringify({
  technicalContent: { summary: "Você mencionou CI/CD e um projeto com GLCM.", strengths: [], gaps: [] },
  englishCommunication: { clarity: "MOSTLY_CLEAR", patterns },
  priorities: [],
}), { roleContext, turns } as InterviewReportInput).report?.englishCommunication.patterns ?? [];

describe("QA analyst calibration", () => {
  it("does not report spelling out a contraction as a correction", () => {
    expect(patternsOf([{ type: "GRAMMAR", sequenceNumber: 1, evidence: "I've been... working and building many projects", suggestion: "Use o presente perfeito contínuo para ações que continuam no presente.", rephrasedExample: "I have been working and building many projects." }])).toEqual([]);
  });

  it("rejects a correction that is itself wrong English", () => {
    expect(patternsOf([{ type: "GRAMMAR", sequenceNumber: 3, evidence: "for do tax and Fork", suggestion: "Use a preposição 'to' antes de verbos no infinitivo.", rephrasedExample: "for to do tax and fork." }])).toEqual([]);
  });

  it("does not blame the candidate for Whisper's spelling of an acronym", () => {
    expect(patternsOf([{ type: "WORD_CHOICE", sequenceNumber: 7, evidence: "to use the gelsm", suggestion: "Use o termo correto para a ferramenta.", rephrasedExample: "to use the GLCM." }])).toEqual([]);
  });

  it("keeps a real preposition fix", () => {
    const [found] = patternsOf([{ type: "GRAMMAR", sequenceNumber: 5, evidence: "I'm working in a project", suggestion: "Use 'on' para projetos: I'm working on a project.", rephrasedExample: "I'm working on a project." }]);
    expect(found?.rephrasedExample).toBe("I'm working on a project.");
  });
});
