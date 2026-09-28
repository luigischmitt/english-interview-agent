import type { InterviewReportInput } from "../../src/thinking/types.js";

const roleContext = { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" };

type TechnicalItem = { sequenceNumber: number; evidence: string; explanation: string };
type EnglishPattern = { type: string; sequenceNumber: number; evidence: string; suggestion: string; rephrasedExample: string };
type Priority = { area: string; sequenceNumber: number; evidence: string; focus: string; exercise: string };

export type InterviewReportEvalExpected = {
  result: "valid";
  summary: string;
  forbiddenSummaryClaims: string[];
  strengths: TechnicalItem[];
  gaps: TechnicalItem[];
  patterns: EnglishPattern[];
  evidenceStatus: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT";
  priorities: Priority[];
  optionalItems: { candidates: number; accepted: number; rejected: number };
} | { result: "invalid" };

function validExpected(overrides: Partial<Extract<InterviewReportEvalExpected, { result: "valid" }>> = {}): Extract<InterviewReportEvalExpected, { result: "valid" }> {
  return {
    result: "valid",
    summary: "A resposta descreve uma decisão técnica.",
    forbiddenSummaryClaims: [],
    strengths: [],
    gaps: [],
    patterns: [],
    evidenceStatus: "INSUFFICIENT",
    priorities: [],
    optionalItems: { candidates: 0, accepted: 0, rejected: 0 },
    ...overrides,
  };
}

const emptyReport = {
  technicalContent: { summary: "A resposta descreve uma decisão técnica.", strengths: [], gaps: [] },
  englishCommunication: { clarity: "CLEAR", patterns: [] },
  priorities: [],
};

export const interviewReportEvalFixtures = [
  {
    name: "detailed answer grounds summary, strength, gap, explanation, and exercise",
    input: {
      roleContext,
      turns: [{ sequenceNumber: 1, question: "How do you make a service resilient?", answer: "I set a 2-second timeout, retry twice with jitter, and send failures to a queue." }],
    } satisfies InterviewReportInput,
    providerOutput: {
      ...emptyReport,
      technicalContent: {
        summary: "Define um timeout de dois segundos, duas tentativas com jitter e uma fila para falhas.",
        strengths: [{ sequenceNumber: 1, evidence: "retry twice with jitter", explanation: "A resposta limita as tentativas e inclui jitter." }],
        gaps: [{ sequenceNumber: 1, evidence: "send failures to a queue", explanation: "A resposta não explica como a fila é processada." }],
      },
      priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 1, evidence: "send failures to a queue", focus: "Processamento da fila", exercise: "Explique como a fila processa falhas e evita duplicatas." }],
    },
    expected: validExpected({
      summary: "Define um timeout de dois segundos, duas tentativas com jitter e uma fila para falhas.",
      strengths: [{ sequenceNumber: 1, evidence: "retry twice with jitter", explanation: "A resposta limita as tentativas e inclui jitter." }],
      gaps: [{ sequenceNumber: 1, evidence: "send failures to a queue", explanation: "A resposta não explica como a fila é processada." }],
      priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 1, evidence: "send failures to a queue", focus: "Processamento da fila", exercise: "Explique como a fila processa falhas e evita duplicatas." }],
      optionalItems: { candidates: 3, accepted: 3, rejected: 0 },
    }),
  },
  {
    name: "tool mention is not promoted to expertise or an invented result",
    input: {
      roleContext,
      turns: [{ sequenceNumber: 1, question: "What cloud tools have you used?", answer: "I used AWS." }],
    } satisfies InterviewReportInput,
    providerOutput: {
      ...emptyReport,
      technicalContent: { summary: "A resposta menciona uso de AWS.", strengths: [], gaps: [] },
    },
    expected: validExpected({
      summary: "A resposta menciona uso de AWS.",
      forbiddenSummaryClaims: ["expert", "especialista", "domina", "reduziu custos"],
    }),
  },
  {
    name: "grammar feedback includes a grounded correction and limited evidence status",
    input: {
      roleContext,
      turns: [{ sequenceNumber: 1, question: "How does the service behave?", answer: "He don't check the cache." }],
    } satisfies InterviewReportInput,
    providerOutput: {
      ...emptyReport,
      englishCommunication: {
        clarity: "MOSTLY_CLEAR",
        patterns: [{ type: "GRAMMAR", sequenceNumber: 1, evidence: "He don't check the cache", suggestion: "Use a forma verbal correspondente ao sujeito he.", rephrasedExample: "He doesn't check the cache." }],
      },
    },
    expected: validExpected({
      patterns: [{ type: "GRAMMAR", sequenceNumber: 1, evidence: "He don't check the cache", suggestion: "Use a forma verbal correspondente ao sujeito he.", rephrasedExample: "He doesn't check the cache." }],
      evidenceStatus: "LIMITED",
      optionalItems: { candidates: 1, accepted: 1, rejected: 0 },
    }),
  },
  {
    name: "legitimate absence of a language pattern remains explicit",
    input: {
      roleContext,
      turns: [{ sequenceNumber: 1, question: "How do you monitor a service?", answer: "I monitor errors and latency." }],
    } satisfies InterviewReportInput,
    providerOutput: { ...emptyReport },
    expected: validExpected({
      summary: "A resposta descreve uma decisão técnica.",
      evidenceStatus: "INSUFFICIENT",
      optionalItems: { candidates: 0, accepted: 0, rejected: 0 },
    }),
  },
  {
    name: "cross-turn evidence is rejected rather than reassigned",
    input: {
      roleContext,
      turns: [
        { sequenceNumber: 2, question: "What did you build?", answer: "I added a cache with Redis." },
        { sequenceNumber: 5, question: "How did you test it?", answer: "I wrote tests for retries." },
      ],
    } satisfies InterviewReportInput,
    providerOutput: {
      ...emptyReport,
      technicalContent: {
        summary: "Uma resposta menciona Redis e a outra descreve testes de retries.",
        gaps: [],
        strengths: [
          { sequenceNumber: 2, evidence: "added a cache with Redis", explanation: "A resposta identifica a mudança feita." },
          { sequenceNumber: 5, evidence: "added a cache with Redis", explanation: "Evidência copiada de outra resposta." },
        ],
      },
    },
    expected: validExpected({
      summary: "Uma resposta menciona Redis e a outra descreve testes de retries.",
      strengths: [{ sequenceNumber: 2, evidence: "added a cache with Redis", explanation: "A resposta identifica a mudança feita." }],
      optionalItems: { candidates: 2, accepted: 1, rejected: 1 },
    }),
  },
  {
    name: "transcription noise is discarded while a real grammar issue remains",
    input: {
      roleContext,
      turns: [{ sequenceNumber: 1, question: "What did you implement?", answer: "I has add retries. TFFF. pfffff." }],
    } satisfies InterviewReportInput,
    providerOutput: {
      ...emptyReport,
      englishCommunication: {
        clarity: "MOSTLY_CLEAR",
        patterns: [
          { type: "GRAMMAR", sequenceNumber: 1, evidence: "I has add retries", suggestion: "Use uma forma verbal consistente para descrever a implementação.", rephrasedExample: "I added retries." },
          { type: "WORD_CHOICE", sequenceNumber: 1, evidence: "TFFF", suggestion: "Revise essa palavra.", rephrasedExample: "I added retries." },
          { type: "WORD_CHOICE", sequenceNumber: 1, evidence: "pfffff", suggestion: "Revise essa palavra.", rephrasedExample: "I added retries." },
        ],
      },
    },
    expected: validExpected({
      patterns: [{ type: "GRAMMAR", sequenceNumber: 1, evidence: "I has add retries", suggestion: "Use uma forma verbal consistente para descrever a implementação.", rephrasedExample: "I added retries." }],
      evidenceStatus: "LIMITED",
      optionalItems: { candidates: 3, accepted: 1, rejected: 2 },
    }),
  },
  {
    name: "duplicate findings are removed and counted as parser rejections",
    input: {
      roleContext,
      turns: [{ sequenceNumber: 1, question: "How does the service work?", answer: "This request depends of the cache." }],
    } satisfies InterviewReportInput,
    providerOutput: {
      ...emptyReport,
      englishCommunication: {
        clarity: "MOSTLY_CLEAR",
        patterns: [
          { type: "WORD_CHOICE", sequenceNumber: 1, evidence: "depends of", suggestion: "Use a preposição adequada para indicar dependência.", rephrasedExample: "This request depends on the cache." },
          { type: "WORD_CHOICE", sequenceNumber: 1, evidence: " depends of ", suggestion: "Use a preposição adequada para indicar dependência.", rephrasedExample: "This request depends on the cache." },
        ],
      },
    },
    expected: validExpected({
      patterns: [{ type: "WORD_CHOICE", sequenceNumber: 1, evidence: "depends of", suggestion: "Use a preposição adequada para indicar dependência.", rephrasedExample: "This request depends on the cache." }],
      evidenceStatus: "LIMITED",
      optionalItems: { candidates: 2, accepted: 1, rejected: 1 },
    }),
  },
  {
    name: "malformed model JSON is distinguished from optional-item rejection",
    input: {
      roleContext,
      turns: [{ sequenceNumber: 1, question: "What did you implement?", answer: "I implemented retries." }],
    } satisfies InterviewReportInput,
    providerOutput: "{not-json",
    expected: { result: "invalid" },
  },
] as const;
