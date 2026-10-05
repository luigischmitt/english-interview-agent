import { describe, expect, it } from "vitest";

import { evaluateInterviewReportProviderOutput } from "../src/thinking/openrouter-interview-report-service.js";
import type { InterviewReportInput } from "../src/thinking/types.js";

/** Third real Whisper-transcribed report (Data Analyst, senior): unchanged rephrases, wrong rule label, over-filtering. */
const roleContext = { targetRole: "Data Analyst", seniority: "senior", focus: "technical-depth" };
const turns: InterviewReportInput["turns"] = [
  { sequenceNumber: 1, question: "Which part of your experience would be most valuable in this position?", answer: "So the most valuable in this position is my experience in analyzing data with Python and using a data data. And using a data. a little expensive project. Um... Many projects... And in this project, I use and uh python and explorer data and this can this can direct to me for this for deer's rule. Thank you." },
  { sequenceNumber: 2, question: "What kind of data did you explore in that project?", answer: "So one type of data that I explored is the data that I have is Jada's... about waves. I am developing a machine learning model to identify what is the best day for surf. So, to reduce. I did a web scraping. And... websites and remove the best data of waves of weather ... all of the things that influence in this Earth. And with this I am developing this model." },
  { sequenceNumber: 3, question: "How did you handle missing or inconsistent data in your web scraping process?", answer: "So first, Later I use these data I need to do. Careful? ... I need to explore if I had... Datas with empty information or data with unreal informations and near to health and i need to help these datas and change This Eros. And after that, I had... dataset with high health..." },
  { sequenceNumber: 4, question: "How did you identify and correct unreal information in the data?", answer: "I'm using... programming logical and maybe I can use the Demir de... Oh my God, how I can say that? Uh... Use the meal. the mean mean sorry the mean of the data of the values and in the items, in the rows that I had incorrect information, I can substitute that for my mean of my values and can I can correct that's that one unreal information Okay. Thank you." },
];
const run = (overrides: Record<string, unknown>) => evaluateInterviewReportProviderOutput(JSON.stringify({
  technicalContent: { summary: "Você descreveu um modelo de previsão de ondas.", strengths: [], gaps: [] },
  englishCommunication: { clarity: "MOSTLY_CLEAR", patterns: [] },
  priorities: [],
  ...overrides,
}), { roleContext, turns } as InterviewReportInput);
const patternsOf = (patterns: unknown[]) => run({ englishCommunication: { clarity: "MOSTLY_CLEAR", patterns } });
const item = (sequenceNumber: number, evidence: string, explanation: string) => ({ sequenceNumber, evidence, explanation, vacancyCompetency: null });

describe("data analyst calibration", () => {
  it("rejects a rephrase identical to a garbled excerpt", () => {
    const result = patternsOf([{ type: "GRAMMAR", sequenceNumber: 1, evidence: "And using a data. a little expensive project.", suggestion: "Use o artigo corretamente antes do substantivo.", rephrasedExample: "And using a data. a little expensive project." }]);
    expect(result.report?.englishCommunication.patterns).toEqual([]);
    const clean = patternsOf([{ type: "GRAMMAR", sequenceNumber: 1, evidence: "using a data data", suggestion: "Use o artigo corretamente antes do substantivo.", rephrasedExample: "Using a data data!" }]);
    expect(clean.report?.englishCommunication.patterns).toEqual([]);
  });

  it("relabels for + surf as a gerund rule instead of a preposition", () => {
    const result = patternsOf([{ type: "GRAMMAR", sequenceNumber: 2, evidence: "the best day for surf", suggestion: "Use a preposição correta antes do substantivo.", rephrasedExample: "the best day for surfing." }]);
    const [found] = result.report?.englishCommunication.patterns ?? [];
    expect(found?.suggestion).toContain("gerúndio");
    expect(found?.suggestion).toContain("for surfing");
    expect(found?.suggestion).not.toMatch(/Use a preposição correta/);
  });

  it("rejects a technical gap and priority built on garbled evidence, and a generic exercise", () => {
    const garbled = "And using a data. a little expensive project.";
    const result = run({
      technicalContent: { summary: "Você descreveu seu uso de Python.", strengths: [], gaps: [item(1, garbled, "Você não explicou como a análise se relaciona com a posição.")] },
      priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 1, evidence: garbled, focus: "Relevância para o cargo", exercise: "Explique em duas frases como a limpeza de dados com Python se aplica a relatórios de vendas.", vacancyCompetency: null }],
    });
    expect(result.report?.technicalContent.gaps).toEqual([]);
    expect(result.report?.priorities).toEqual([]);

    const generic = run({
      technicalContent: { summary: "Você descreveu seu uso de Python.", strengths: [item(4, "substitute that for my mean of my values", "Você substituiu valores incorretos pela média da coluna.")], gaps: [] },
      priorities: [
        { area: "TECHNICAL_CONTENT", sequenceNumber: 4, evidence: "substitute that for my mean of my values", focus: "Imputação pela média", exercise: "Pratique explicar como suas habilidades técnicas resolvem problemas específicos do cargo.", vacancyCompetency: null },
        { area: "ENGLISH_COMMUNICATION", sequenceNumber: 2, evidence: "the best day for surf", focus: "Gerúndio após preposição", exercise: "Pratique usar preposições corretas em frases.", vacancyCompetency: null },
      ],
    });
    expect(generic.report?.priorities).toEqual([]);
    const concrete = run({
      technicalContent: { summary: "Você descreveu seu uso de Python.", strengths: [item(4, "substitute that for my mean of my values", "Você substituiu valores incorretos pela média da coluna.")], gaps: [] },
      priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 4, evidence: "substitute that for my mean of my values", focus: "Imputação pela média", exercise: "Grave uma resposta de 40 segundos explicando por que usou a média e não a mediana, citando outliers.", vacancyCompetency: null }],
    });
    expect(concrete.report?.priorities).toHaveLength(1);
  });

  it("accepts clean mean-imputation strength excerpts from the noisy answer", () => {
    for (const evidence of ["substitute that for my mean of my values", "the mean of the data of the values"]) {
      const result = run({ technicalContent: { summary: "Você descreveu seu uso de Python.", strengths: [item(4, evidence, "Você substituiu valores incorretos pela média da coluna.")], gaps: [] } });
      expect(result.report?.technicalContent.strengths).toHaveLength(1);
    }
    const gap = run({ technicalContent: { summary: "Você descreveu seu uso de Python.", strengths: [], gaps: [item(4, "substitute that for my mean of my values", "A média é sensível a outliers; vale citar a mediana ou sinalizar as linhas alteradas.")] } });
    expect(gap.report?.technicalContent.gaps).toHaveLength(1);
  });
});
