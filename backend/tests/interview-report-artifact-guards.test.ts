import { describe, expect, it } from "vitest";

import { defaultInterviewTurnAnalysisTimeoutMs } from "../src/thinking/config.js";
import { evaluateInterviewReportProviderOutput } from "../src/thinking/openrouter-interview-report-service.js";
import type { InterviewReportInput } from "../src/thinking/types.js";

/** Second real Whisper-transcribed report (Software Engineer): mis-heard names and wrong rule labels. */
const roleContext = { targetRole: "Software Engineer", seniority: "mid-level", focus: "technical-depth" };
const turns: InterviewReportInput["turns"] = [
  { sequenceNumber: 1, question: "Can you tell me about your experience and what makes you a strong fit for Software Engineer?", answer: "One of these projects is the run shop and Russia is a full stack system, which has, sorry, which has AI agent integrated with the WhatsApp. Put something or... Gad's something more faster than using papers or using Bruce Forrest." },
  { sequenceNumber: 2, question: "What AI technologies did you use in the WhatsApp agent?", answer: "So I used one API key of the Gemini. And I use this API to interpret better the messages. So... Um... I started using a colder for interpret this natural language message. I decided to implement this API and call the Gemini to read The messages in build. Jason, a street director at Jason. to with the action with the values and with the items" },
  { sequenceNumber: 3, question: "Can you describe a project you owned from start to finish, including your part and the result?", answer: "I'm I'm in beauty in machine learning model to identify and breast cancer. in mammographs. I can't have expensive data set, and I need to use data generation with AI. I am building this framework using the GLCM and the GLCM Z2." },
  { sequenceNumber: 4, question: "How did you choose GLCM and GLCM Z2 for comparing synthetic images?", answer: "So, I choose To use the GLCM after I read books and websites and see what the people's using to assess images and the Most important thing. is, uh... Test. So I use the GLCM in real images." },
];
const pattern = (type: string, sequenceNumber: number, evidence: string, suggestion: string, rephrasedExample: string) => ({ type, sequenceNumber, evidence, suggestion, rephrasedExample });
const run = (overrides: Record<string, unknown>) => evaluateInterviewReportProviderOutput(JSON.stringify({
  technicalContent: { summary: "Você descreveu um sistema com agente de IA no WhatsApp.", strengths: [], gaps: [] },
  englishCommunication: { clarity: "MOSTLY_CLEAR", patterns: [] },
  priorities: [],
  ...overrides,
}), { roleContext, turns } as InterviewReportInput);
const patternsOf = (patterns: unknown[]) => run({ englishCommunication: { clarity: "MOSTLY_CLEAR", patterns } });

describe("English pattern artifact guard", () => {
  it("drops a mis-heard proper noun that the rephrase replaces with an invented name", () => {
    for (const type of ["GRAMMAR", "WORD_CHOICE"]) {
      const result = patternsOf([pattern(type, 1, "Russia is a full stack system", "Use os nomes corretos dos projetos ao descrevê-los.", "Run Shop is a full stack system.")]);
      expect(result.report?.englishCommunication.patterns).toEqual([]);
      expect(result.diagnostics.optionalItems.rejectionReasons.artifact).toBe(1);
    }
  });

  it("drops a garbled excerpt whose rephrase rewrites most content words", () => {
    const result = patternsOf([pattern("GRAMMAR", 3, "I'm I'm in beauty in machine learning model to identify and breast cancer", "Use o verbo no presente contínuo para descrever o projeto atual.", "I'm working on a machine learning model to identify breast cancer.")]);
    expect(result.report?.englishCommunication.patterns).toEqual([]);
    expect(result.diagnostics.optionalItems.rejectionReasons.artifact).toBe(1);
  });

  it("keeps for + verb with the real rule instead of the wrong gerund label", () => {
    const result = patternsOf([pattern("GRAMMAR", 2, "for interpret this natural language message", "Esta é a forma correta do gerúndio.", "to interpret this natural language message.")]);
    expect(result.report?.englishCommunication.patterns).toEqual([pattern("GRAMMAR", 2, "for interpret this natural language message", "Use to + verbo base para indicar finalidade: to interpret.", "to interpret this natural language message.")]);
  });

  it("keeps choose to chose and replaces the wrong agreement label with the past tense rule", () => {
    const result = patternsOf([pattern("GRAMMAR", 4, "I choose To use the GLCM", "Ajuste a concordância verbal desta frase.", "I chose to use the GLCM.")]);
    expect(result.report?.englishCommunication.patterns).toEqual([pattern("GRAMMAR", 4, "I choose To use the GLCM", "Use o passado do verbo: o passado de choose é chose.", "I chose to use the GLCM.")]);
  });

  it("keeps comparative fixes and replaces a contradictory rule explanation", () => {
    const comparativeTurns = [{ sequenceNumber: 1, question: "What improved?", answer: "This data is more fast, more easier for him." }];
    const result = evaluateInterviewReportProviderOutput(JSON.stringify({
      technicalContent: { summary: "Você descreveu uma melhoria no acesso aos dados.", strengths: [], gaps: [] },
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns: [pattern("GRAMMAR", 1, "This data is more fast, more easier for him", "Use more com adjetivos no comparativo.", "This data is faster and easier for him.")] },
      priorities: [],
    }), { roleContext, turns: comparativeTurns } as InterviewReportInput);
    expect(result.report?.englishCommunication.patterns[0]?.suggestion).toBe("Use o comparativo sem more antes de formas em -er: faster e easier.");
  });

  it("keeps a correct label untouched and drops a wrong label without a generable rule", () => {
    const ok = patternsOf([pattern("GRAMMAR", 4, "I choose To use the GLCM", "Use o passado simples porque a ação já aconteceu.", "I chose to use the GLCM.")]);
    expect(ok.report?.englishCommunication.patterns).toHaveLength(1);
    const wrong = patternsOf([pattern("GRAMMAR", 4, "So I use the GLCM in real images", "Corrija a concordância verbal desta frase.", "So I use the GLCM on real images.")]);
    expect(wrong.report?.englishCommunication.patterns).toEqual([]);
  });
});

describe("technical relevance filter", () => {
  it("drops integration gaps and priorities when the question asked which technologies were used", () => {
    const result = run({
      technicalContent: { summary: "Você descreveu um sistema com agente de IA no WhatsApp.", strengths: [], gaps: [
        { sequenceNumber: 2, evidence: "I decided to implement this API", explanation: "Você não explicou como a API foi integrada ao sistema." },
      ] },
      priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 2, evidence: "I used one API key of the Gemini", focus: "Explicar a integração da API", exercise: "Descreva em voz alta como você integrou a API ao agente." }],
    });
    expect(result.report?.technicalContent.gaps).toEqual([]);
    expect(result.report?.priorities).toEqual([]);
  });

  it("keeps integration gaps when the question asked how something was built", () => {
    const gaps = [{ sequenceNumber: 4, evidence: "I use the GLCM in real images", explanation: "Você não explicou como implementou a comparação." }];
    const withQuestion = evaluateInterviewReportProviderOutput(JSON.stringify({
      technicalContent: { summary: "Resumo objetivo.", strengths: [], gaps }, englishCommunication: { clarity: "MOSTLY_CLEAR", patterns: [] }, priorities: [],
    }), { roleContext, turns: [{ ...turns[3]!, question: "How did you implement the comparison?" }] } as InterviewReportInput);
    expect(withQuestion.report?.technicalContent.gaps).toHaveLength(1);
  });
});

describe("turn analysis deadline", () => {
  it("allows 30 s end to end", () => expect(defaultInterviewTurnAnalysisTimeoutMs).toBe(30_000));
});
