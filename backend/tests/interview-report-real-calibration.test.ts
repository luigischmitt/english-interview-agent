import { describe, expect, it } from "vitest";

import { evaluateInterviewReportProviderOutput, hasMissingPortugueseAccents, isTrivialStrength, looksLikeEnglishSentence, repairThirdPerson } from "../src/thinking/openrouter-interview-report-service.js";
import type { InterviewReportInput } from "../src/thinking/types.js";

/** Excerpts from a real Whisper-transcribed interview (Software/AI role) that produced a noisy report. */
const roleContext = { targetRole: "Software Engineer (AI)", seniority: "mid-level", focus: "technical-depth" };
const turns: InterviewReportInput["turns"] = [
  { sequenceNumber: 1, question: "Tell me about a project you are proud of.", answer: "I use the next.js for the frontend and the backend I use node.js. They're stained. Natural language in WhatsApp. It's using the super base and the versal to... to hospital all of this thing." },
  { sequenceNumber: 2, question: "What was your role?", answer: "A project that I worked on is a framework to available synthetic images. I did it to facilitated their life Off the manager. I worked in several projects." },
];
const gap = (sequenceNumber: number, evidence: string, explanation: string) => ({ sequenceNumber, evidence, explanation });
const pattern = (sequenceNumber: number, evidence: string, rephrasedExample: string) => ({ type: "GRAMMAR", sequenceNumber, evidence, suggestion: "Use a forma verbal correta nesta frase.", rephrasedExample });
const report = (overrides: Record<string, unknown>) => evaluateInterviewReportProviderOutput(JSON.stringify({
  technicalContent: { summary: "Você descreveu o projeto Rancho e sua stack.", strengths: [], gaps: [] },
  englishCommunication: { clarity: "MOSTLY_CLEAR", patterns: [] },
  priorities: [],
  ...overrides,
}), { roleContext, turns } as InterviewReportInput);

describe("real report calibration", () => {
  it("keeps clear English errors from clean spans even when the same answer contains Whisper noise", () => {
    const latestTurns = [{
      sequenceNumber: 4,
      question: "What was the AI agent's specific task?",
      answer: "The task is to see resumes and the stock. Instead of the manager needs to see in sheets or papers, he sends a message. This data is more fast, more easier for him.",
    }];
    const result = evaluateInterviewReportProviderOutput(JSON.stringify({
      technicalContent: { summary: "Você descreveu o acesso aos dados pelo WhatsApp.", strengths: [], gaps: [] },
      englishCommunication: {
        clarity: "MOSTLY_CLEAR",
        patterns: [
          pattern(4, "Instead of the manager needs to see in sheets or papers, he sends a message", "Instead of the manager needing to see in sheets or papers, he sends a message."),
          pattern(4, "This data is more fast, more easier for him", "This data is faster and easier for him."),
        ],
      },
      priorities: [],
    }), { roleContext, turns: latestTurns } as InterviewReportInput);
    expect(result.report?.englishCommunication.patterns.map(({ evidence }) => evidence)).toEqual([
      "Instead of the manager needs to see in sheets or papers, he sends a message",
      "This data is more fast, more easier for him",
    ]);
    expect(result.report?.englishCommunication.patterns[1]?.suggestion).toBe("Use o comparativo sem more antes de formas em -er: faster e easier.");
  });

  it("rejects a grammar correction that makes a valid phrase look wrong by deleting a content verb", () => {
    const latestTurns = [{ sequenceNumber: 2, question: "Tell me about your experience.", answer: "I have been working and building many projects." }];
    const result = evaluateInterviewReportProviderOutput(JSON.stringify({
      technicalContent: { summary: "Você descreveu sua experiência em projetos.", strengths: [], gaps: [] },
      englishCommunication: { clarity: "CLEAR", patterns: [{ type: "GRAMMAR", sequenceNumber: 2, evidence: "I have been working and building many projects", suggestion: "Use o present perfect para ações contínuas.", rephrasedExample: "I have been working on many projects." }] },
      priorities: [],
    }), { roleContext, turns: latestTurns } as InterviewReportInput);
    expect(result.report?.englishCommunication.patterns).toEqual([]);
    expect(result.diagnostics.optionalItems.rejectionReasons.artifact).toBe(1);
  });

  it("rejects technical items and English patterns built on likely transcription artifacts", () => {
    const result = report({
      technicalContent: {
        summary: "Você descreveu o projeto Rancho e sua stack.",
        strengths: [],
        gaps: [
          gap(1, "They're stained. Natural language in WhatsApp.", "Você não explicou como o modelo foi treinado."),
          gap(1, "using the super base and the versal", "Você não explicou como hospedou a solução."),
          gap(1, "to... to hospital all of this thing", "Você não explicou a hospedagem do sistema."),
        ],
      },
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns: [pattern(1, "the super base and the versal", "I use Supabase and Vercel.")] },
    });
    expect(result.report?.technicalContent.gaps).toEqual([]);
    expect(result.report?.englishCommunication.patterns).toEqual([]);
    expect(result.diagnostics.optionalItems.rejectionReasons.artifact).toBe(4);
  });

  it("rejects trivial 'mentioned technology X' strengths and keeps a real one, capped at 2", () => {
    const real = gap(1, "I use the next.js for the frontend", "Você justificou a escolha do Next.js para o frontend.");
    const result = report({
      technicalContent: {
        summary: "Você descreveu o projeto.",
        strengths: [
          gap(1, "I use the next.js for the frontend", "O candidato mencionou a tecnologia Next.js."),
          gap(1, "the backend I use node.js", "Você mencionou Node.js no backend."),
          gap(2, "I worked in several projects", "Você mencionou que trabalhou em vários projetos."),
          real,
          gap(2, "A project that I worked on", "Você liderou o desenho do framework de imagens sintéticas."),
          gap(2, "I did it", "Você entregou o resultado para os gerentes."),
        ],
        gaps: [],
      },
    });
    expect(result.report?.technicalContent.strengths).toEqual([real, gap(2, "A project that I worked on", "Você liderou o desenho do framework de imagens sintéticas.")]);
    expect(result.diagnostics.optionalItems.rejectionReasons).toMatchObject({ invalidFormat: 3, limit: 1 });
    expect(isTrivialStrength("O candidato mencionou a tecnologia Next.js.")).toBe(true);
    expect(isTrivialStrength("Você justificou a escolha do Next.js para o frontend.")).toBe(false);
  });

  it("caps technical gaps at 3 in the report", () => {
    const answer = "x";
    const many = ["I use the next.js for the frontend", "the backend I use node.js", "A project that I worked on", "I worked in several projects"];
    const result = report({
      technicalContent: { summary: "Resumo objetivo.", strengths: [], gaps: many.map((evidence, index) => gap(index < 2 ? 1 : 2, evidence, "Você não explicou o resultado pedido pela pergunta.")) },
    });
    expect(answer).toBe("x");
    expect(result.report?.technicalContent.gaps).toHaveLength(3);
  });

  it("rejects English sentences in Portuguese fields and repairs third person", () => {
    const result = report({
      technicalContent: {
        summary: "Você descreveu o projeto.",
        strengths: [],
        gaps: [
          gap(2, "A project that I worked on", "The candidate did not clearly state their specific role in the project."),
          gap(2, "I did it to facilitated", "O candidato não explicou o resultado entregue aos gerentes."),
          gap(2, "I worked in several projects", "O papel do candidato no projeto não ficou claro."),
        ],
      },
    });
    expect(result.report?.technicalContent.gaps).toEqual([gap(2, "I did it to facilitated", "Você não explicou o resultado entregue aos gerentes.")]);
    expect(looksLikeEnglishSentence("The candidate did not clearly state their specific role in the project.")).toBe(true);
    expect(looksLikeEnglishSentence("Use o present perfect com last month apenas no passado simples.")).toBe(false);
    expect(repairThirdPerson("O candidato explicou o fluxo.")).toBe("Você explicou o fluxo.");
    expect(hasMissingPortugueseAccents("Voce nao explicou a comunicacao.")).toBe(true);
  });
});
