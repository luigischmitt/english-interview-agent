import type { InterviewReportInput } from "../../src/thinking/types.js";

const roleContext = { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" };

type TechnicalItem = { sequenceNumber: number; evidence: string; explanation: string };
type EnglishPattern = { type: string; sequenceNumber: number; evidence: string; suggestion: string; rephrasedExample: string };
type Priority = { area: string; sequenceNumber: number; evidence: string; focus: string; exercise: string };

export type InterviewReportEvalExpected = {
  result: "valid";
  summary: string;
  forbiddenSummaryClaims: string[];
  forbiddenGapExplanations?: string[];
  strengths: TechnicalItem[];
  gaps: TechnicalItem[];
  patterns: EnglishPattern[];
  evidenceStatus: "SUFFICIENT" | "LIMITED" | "INSUFFICIENT" | "NO_PATTERN_FOUND" | "CANDIDATES_REJECTED";
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
    evidenceStatus: "NO_PATTERN_FOUND",
    priorities: [],
    optionalItems: { candidates: 0, accepted: 0, rejected: 0 },
    ...overrides,
  };
}

// Reason counts are asserted directly by focused tests; the corpus also checks
// the stable aggregate totals so existing fixtures remain concise.

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
    name: "punctuation-normalized evidence maps back to literal same-turn spans",
    input: {
      roleContext,
      turns: [{ sequenceNumber: 4, question: "What change improved the service?", answer: "We added an index, then checked the query plan." }],
    } satisfies InterviewReportInput,
    providerOutput: {
      ...emptyReport,
      technicalContent: {
        summary: "A resposta relata a inclusão de um índice e a verificação do plano de consulta.",
        strengths: [{ sequenceNumber: 4, evidence: "ADDED AN INDEX THEN", explanation: "A resposta registra a mudança feita" }],
        gaps: [],
      },
      priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 4, evidence: "THE QUERY PLAN", focus: "Verificação do plano", exercise: "Descreva em voz alta como você verificou o plano" }],
    },
    expected: validExpected({
      summary: "A resposta relata a inclusão de um índice e a verificação do plano de consulta.",
      strengths: [{ sequenceNumber: 4, evidence: "added an index, then", explanation: "A resposta registra a mudança feita." }],
      priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 4, evidence: "the query plan", focus: "Verificação do plano", exercise: "Descreva em voz alta como você verificou o plano." }],
      optionalItems: { candidates: 2, accepted: 2, rejected: 0 },
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
      evidenceStatus: "NO_PATTERN_FOUND",
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
    name: "all unsupported English suggestions are rejected and reported distinctly",
    input: {
      roleContext,
      turns: [{ sequenceNumber: 1, question: "What did you implement?", answer: "I built the service with retries." }],
    } satisfies InterviewReportInput,
    providerOutput: {
      ...emptyReport,
      englishCommunication: {
        clarity: "MOSTLY_CLEAR",
        patterns: [{ type: "GRAMMAR", sequenceNumber: 1, evidence: "I built the application", suggestion: "Revise essa construção.", rephrasedExample: "I built the service." }],
      },
    },
    expected: validExpected({ evidenceStatus: "CANDIDATES_REJECTED", optionalItems: { candidates: 1, accepted: 0, rejected: 1 } }),
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
    name: "report covers distinct isolated Brazilian Portuguese speaker English patterns without inventing tangential gaps",
    input: {
      roleContext,
      turns: [
        { sequenceNumber: 1, question: "How did you improve API performance, and what result did you measure?", answer: "I added index to the reports table. I have presented it last month. P99 latency fell to 800 milliseconds." },
        { sequenceNumber: 2, question: "Can you tell me about a migration you worked on?", answer: "We realized a staged migration in two steps. We checked errors between them. We discussed about the rollback, and I was responsible of the change." },
      ],
    } satisfies InterviewReportInput,
    providerOutput: {
      ...emptyReport,
      technicalContent: {
        summary: "A pessoa relata ter adicionado um índice, queda da latência P99 para 800 milissegundos e migração em etapas com verificação de erros.",
        strengths: [{ sequenceNumber: 1, evidence: "P99 latency fell to 800 milliseconds", explanation: "A resposta apresenta um resultado mensurável para a mudança." }],
        gaps: [],
      },
      englishCommunication: {
        clarity: "MOSTLY_CLEAR",
        patterns: [
          { type: "GRAMMAR", sequenceNumber: 1, evidence: "added index", suggestion: "Inclua o artigo indefinido antes de um substantivo contável singular.", rephrasedExample: "I added an index to the reports table." },
          { type: "GRAMMAR", sequenceNumber: 1, evidence: "have presented it last month", suggestion: "Com um período encerrado como last month, use simple past em vez de present perfect.", rephrasedExample: "I presented it last month." },
          { type: "FALSE_COGNATE", sequenceNumber: 2, evidence: "realized a staged migration", suggestion: "Use o verbo que significa executar uma migração; realized significa perceber ou compreender.", rephrasedExample: "We carried out a staged migration in two steps." },
          { type: "WORD_CHOICE", sequenceNumber: 2, evidence: "discussed about the rollback", suggestion: "Retire a preposição após o verbo discuss, que recebe o assunto diretamente.", rephrasedExample: "We discussed the rollback." },
          { type: "WORD_CHOICE", sequenceNumber: 2, evidence: "responsible of the change", suggestion: "Use a colocação responsible for para indicar responsabilidade por algo.", rephrasedExample: "I was responsible for the change." },
        ],
      },
    },
    expected: validExpected({
      summary: "A pessoa relata ter adicionado um índice, queda da latência P99 para 800 milissegundos e migração em etapas com verificação de erros.",
      forbiddenSummaryClaims: ["não respondeu à pergunta", "não abordou a migração"],
      forbiddenGapExplanations: ["Não explica como apresentou o resultado", "Não detalha critérios nem passos opcionais"],
      strengths: [{ sequenceNumber: 1, evidence: "P99 latency fell to 800 milliseconds", explanation: "A resposta apresenta um resultado mensurável para a mudança." }],
      gaps: [],
      patterns: [
        { type: "GRAMMAR", sequenceNumber: 1, evidence: "added index", suggestion: "Inclua o artigo indefinido antes de um substantivo contável singular.", rephrasedExample: "I added an index to the reports table." },
        { type: "GRAMMAR", sequenceNumber: 1, evidence: "have presented it last month", suggestion: "Com um período encerrado como last month, use simple past em vez de present perfect.", rephrasedExample: "I presented it last month." },
        { type: "FALSE_COGNATE", sequenceNumber: 2, evidence: "realized a staged migration", suggestion: "Use o verbo que significa executar uma migração; realized significa perceber ou compreender.", rephrasedExample: "We carried out a staged migration in two steps." },
        { type: "WORD_CHOICE", sequenceNumber: 2, evidence: "discussed about the rollback", suggestion: "Retire a preposição após o verbo discuss, que recebe o assunto diretamente.", rephrasedExample: "We discussed the rollback." },
      ],
      evidenceStatus: "SUFFICIENT",
      optionalItems: { candidates: 6, accepted: 5, rejected: 1 },
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
