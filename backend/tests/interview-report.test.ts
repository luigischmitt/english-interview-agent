import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { OpenRouterInterviewReportService } from "../src/thinking/openrouter-interview-report-service.js";
import { defaultThinkingModel } from "../src/thinking/config.js";
import type { InterviewReport, InterviewReportInput } from "../src/thinking/types.js";
import type { SpeechConfig } from "../src/speech/config.js";

const speechConfig: SpeechConfig = {
  provider: "fake", kokoroBaseUrl: "http://localhost:8888", kokoroTimeoutMs: 1000,
  interviewerVoice: "af_bella+af_heart", defaultSpeed: 1, format: "mp3",
};
const input: InterviewReportInput = {
  roleContext: { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" },
  turns: [
    { sequenceNumber: 2, question: "How would you improve reliability?", answer: "I would add timeouts and bounded retries." },
    { sequenceNumber: 4, question: "How do you monitor it?", answer: "We monitor errors and latency." },
  ],
};

const validReport: InterviewReport = {
  evidenceReview: {
    technicalStrengths: { candidates: 1, accepted: 1, rejected: 0 },
    technicalGaps: { candidates: 1, accepted: 1, rejected: 0 },
    englishPatterns: { candidates: 1, accepted: 1, rejected: 0 },
    priorities: { candidates: 1, accepted: 1, rejected: 0 },
  },
  technicalContent: {
    summary: "Covers bounded retries and basic monitoring.",
    strengths: [{ sequenceNumber: 2, evidence: "bounded retries", explanation: "Nomeia uma proteção para tentativas repetidas." }],
    gaps: [{ sequenceNumber: 4, evidence: "monitor errors", explanation: "A resposta não explica limites ou alertas." }],
  },
  englishCommunication: {
    clarity: "MOSTLY_CLEAR", evidenceStatus: "LIMITED",
    patterns: [{ type: "GRAMMAR", sequenceNumber: 4, evidence: "We monitor errors", suggestion: "Use o presente simples de forma consistente.", rephrasedExample: "We monitor errors and latency." }],
  },
  priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 4, evidence: "errors and latency", focus: "Limites de alerta", exercise: "Explique em um minuto quais limites acionariam um alerta." }],
};
const providerReport = {
  technicalContent: validReport.technicalContent,
  englishCommunication: { clarity: validReport.englishCommunication.clarity, patterns: validReport.englishCommunication.patterns },
  priorities: validReport.priorities,
};

function providerResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
}

function makeService(fetchImplementation: typeof fetch) {
  return new OpenRouterInterviewReportService({ key: "test-key", model: defaultThinkingModel, timeoutMs: 1234, fetchImplementation });
}

describe("final interview report service", () => {
  it("makes one structured, privacy-routed batch request and returns model/version metadata", async () => {
    let requestBody: unknown;
    const service = makeService(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return providerResponse(JSON.stringify(providerReport));
    });

    await expect(service.generate(input)).resolves.toEqual({ ...validReport, model: defaultThinkingModel, analysisVersion: "v2" });
    const body = requestBody as { provider: unknown; response_format: { json_schema: { strict: boolean; schema: { properties: Record<string, unknown> } } }; messages: Array<{ content: string }> };
    expect(body.provider).toEqual({ require_parameters: true, data_collection: "deny" });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties).not.toHaveProperty("score");
    expect(body.response_format.json_schema.schema.properties).not.toHaveProperty("internal_rationale");
    expect(body.messages[0].content).toContain("Write the report in Brazilian Portuguese");
    expect(body.messages[0].content).toContain("Cite the matching sequenceNumber and a short exact excerpt from that answer");
    expect(body.messages[0].content).toContain("Review each question and its answer as a separate pair");
    expect(body.messages[0].content).toContain("Do not infer mastery, correctness, ownership, impact, or expertise from merely naming a tool");
    expect(body.messages[0].content).toContain("Do not criticize isolated acronyms, names, technical terms, fillers, repeated syllables, phonetic fragments");
    expect(body.messages[0].content).toContain("include a concrete, corrected English rephrasing grounded in that answer");
    const schema = body.response_format.json_schema.schema.properties;
    expect((schema.englishCommunication as { properties: { patterns: { maxItems: number } } }).properties.patterns.maxItems).toBe(8);
    expect((schema.technicalContent as { properties: { strengths: { maxItems: number }; gaps: { maxItems: number } } }).properties.strengths.maxItems).toBe(8);
    expect((schema.technicalContent as { properties: { strengths: { maxItems: number }; gaps: { maxItems: number } } }).properties.gaps.maxItems).toBe(8);
    expect(JSON.parse(body.messages[1].content)).toEqual({ roleContext: input.roleContext, turns: input.turns });
  });

  it("sends all eight completed answers in one report request with enough output budget", async () => {
    const turns = Array.from({ length: 8 }, (_, index) => ({
      sequenceNumber: (index + 1) * 2,
      question: `Question ${index + 1}?`,
      answer: index === 1 ? "We monitor errors and latency." : `Answer ${index + 1} describes the implementation clearly.`,
    }));
    let requestBody: { max_tokens: number; messages: Array<{ content: string }> } | undefined;
    const report = await makeService(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return providerResponse(JSON.stringify(providerReport));
    }).generate({ ...input, turns });

    expect(report.analysisVersion).toBe("v2");
    expect(requestBody?.max_tokens).toBeGreaterThanOrEqual(4_096);
    expect(JSON.parse(requestBody?.messages[1].content ?? "{}").turns).toEqual(turns);
  });

  it("salvages valid report content when an optional evidence item is fabricated", async () => {
    const partiallyInvalid = {
      ...providerReport,
      technicalContent: {
        ...validReport.technicalContent,
        strengths: [...validReport.technicalContent.strengths, { sequenceNumber: 4, evidence: "not in this answer", explanation: "Claim without support." }],
      },
      englishCommunication: {
        ...providerReport.englishCommunication,
        patterns: [...providerReport.englishCommunication.patterns, { ...providerReport.englishCommunication.patterns[0], evidence: "fabricated" }],
      },
    };
    const report = await makeService(async () => providerResponse(JSON.stringify(partiallyInvalid))).generate(input);
    expect(report.technicalContent.strengths).toEqual(validReport.technicalContent.strengths);
    expect(report.englishCommunication.patterns).toEqual(validReport.englishCommunication.patterns);
    expect(report.analysisVersion).toBe("v2");
  });

  it("keeps complete feedback and drops truncated optional prose while recovering a truncated summary", async () => {
    const truncated = {
      ...providerReport,
      technicalContent: {
        ...providerReport.technicalContent,
        summary: "O",
        strengths: [
          { ...providerReport.technicalContent.strengths[0], explanation: "Nomeia uma proteção para solu" },
          { sequenceNumber: 2, evidence: "timeouts", explanation: "A resposta identifica timeouts como proteção." },
        ],
      },
      englishCommunication: {
        ...providerReport.englishCommunication,
        patterns: [{ ...providerReport.englishCommunication.patterns[0], suggestion: "Use o presente simples de forma corre" }],
      },
      priorities: [{ ...providerReport.priorities[0], exercise: "Explique em um minuto quais limites acionariam a documenta" }],
    };
    const report = await makeService(async () => providerResponse(JSON.stringify(truncated))).generate(input);

    expect(report.technicalContent.summary).toBe("As respostas foram analisadas quanto ao conteúdo técnico apresentado.");
    expect(report.technicalContent.strengths).toEqual([{ sequenceNumber: 2, evidence: "timeouts", explanation: "A resposta identifica timeouts como proteção." }]);
    expect(report.englishCommunication.patterns).toEqual([]);
    expect(report.priorities).toEqual([]);
    expect(report.englishCommunication.evidenceStatus).toBe("CANDIDATES_REJECTED");
  });

  it("preserves complete user-facing sentences", async () => {
    const report = await makeService(async () => providerResponse(JSON.stringify(providerReport))).generate(input);

    expect(report).toMatchObject(validReport);
    expect(report.technicalContent.summary).toBe(validReport.technicalContent.summary);
    expect(report.technicalContent.strengths).toEqual(validReport.technicalContent.strengths);
  });

  it("keeps eight distinct English findings", async () => {
    const answer = "I build reliable services. I design clear APIs. I deploy tested changes. I explain technical choices. I review code carefully. I monitor service health. I document useful decisions. I support production systems.";
    const turns = [{ sequenceNumber: 1, question: "Tell me about your work.", answer }];
    const evidence = [
      "I build reliable services", "I design clear APIs", "I deploy tested changes", "I explain technical choices",
      "I review code carefully", "I monitor service health", "I document useful decisions", "I support production systems",
    ];
    const patterns = evidence.map((excerpt, index) => ({
      type: "GRAMMAR",
      sequenceNumber: 1,
      evidence: excerpt,
      suggestion: `Sugestão distinta ${index + 1} para esta resposta.`,
      rephrasedExample: `I can express point ${index + 1} more clearly.`,
    }));
    const report = await makeService(async () => providerResponse(JSON.stringify({
      ...providerReport,
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns },
    }))).generate({ ...input, turns });

    expect(report.englishCommunication.patterns).toHaveLength(8);
    expect(report.englishCommunication.patterns.map((pattern) => pattern.evidence)).toEqual(evidence);
  });

  it("preserves valid short English evidence", async () => {
    const answer = "This request depends of the cache. I use AWS.";
    const turns = [{ sequenceNumber: 1, question: "How does the service work?", answer }];
    const patterns = [
      { type: "WORD_CHOICE", sequenceNumber: 1, evidence: "depends of", suggestion: "Use a preposição adequada para introduzir aquilo de que algo depende.", rephrasedExample: "This request depends on the cache." },
      { type: "GRAMMAR", sequenceNumber: 1, evidence: "I use AWS", suggestion: "Revise a frase completa e mantenha o trecho curto como evidência.", rephrasedExample: "I use AWS for this service." },
    ];
    const report = await makeService(async () => providerResponse(JSON.stringify({
      ...providerReport,
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns },
    }))).generate({ ...input, turns });

    expect(report.englishCommunication.patterns.map((pattern) => pattern.evidence)).toEqual(["depends of", "I use AWS"]);
  });

  it("removes duplicate findings and likely noise or acronym artifacts", async () => {
    const answer = "I build reliable services. I design clear APIs. pfffff. I said TFFF. I heard hahaha. I said...";
    const turns = [{ sequenceNumber: 1, question: "Tell me about your work.", answer }];
    const first = { type: "GRAMMAR", sequenceNumber: 1, evidence: "I build reliable services", suggestion: "Use o presente simples para descrever o trabalho.", rephrasedExample: "I build reliable services every day." };
    const patterns = [
      first,
      { ...first, evidence: " I build reliable services ", suggestion: " Mantenha o tempo presente para explicar o trabalho. " },
      { ...first, evidence: "I design clear APIs" },
      { ...first, evidence: "pfffff", suggestion: "Não corrija este ruído.", rephrasedExample: "This is not an English sentence." },
      { ...first, evidence: "I said TFFF", suggestion: "Não corrija este fragmento.", rephrasedExample: "This is not an English sentence." },
      { ...first, evidence: "I heard hahaha", suggestion: "Não corrija sílabas repetidas.", rephrasedExample: "This is not an English sentence." },
      { ...first, evidence: "I said...", suggestion: "Não corrija este fragmento incompleto.", rephrasedExample: "This is not an English sentence." },
    ];
    const report = await makeService(async () => providerResponse(JSON.stringify({
      ...providerReport,
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns },
    }))).generate({ ...input, turns });

    expect(report.englishCommunication.patterns).toEqual([first]);
  });

  it("does not allow technical observations to cite evidence from a different answer", async () => {
    const mismatched = {
      ...providerReport,
      technicalContent: {
        ...providerReport.technicalContent,
        strengths: [
          { sequenceNumber: 2, evidence: "bounded retries", explanation: "Cita tentativas com limite explícito." },
          { sequenceNumber: 4, evidence: "bounded retries", explanation: "Atribui a outra resposta uma informação que não contém." },
        ],
      },
    };
    const report = await makeService(async () => providerResponse(JSON.stringify(mismatched))).generate(input);

    expect(report.technicalContent.strengths).toEqual([mismatched.technicalContent.strengths[0]]);
  });

  it("rejects unsupported top-level fields", async () => {
    await expect(makeService(async () => providerResponse(JSON.stringify({ ...providerReport, score: 94 }))).generate(input))
      .rejects.toMatchObject({ code: "THINKING_INVALID_PROVIDER_RESPONSE", status: 502 });
  });

  it("maps rate limits, timeouts, and provider failures to standard errors", async () => {
    await expect(makeService(async () => new Response("limit", { status: 429 })).generate(input)).rejects.toMatchObject({ code: "THINKING_RATE_LIMITED", status: 503 });
    await expect(makeService(async () => { throw new DOMException("timeout", "TimeoutError"); }).generate(input)).rejects.toMatchObject({ code: "THINKING_TIMEOUT", status: 504 });
    await expect(makeService(async () => new Response("failed", { status: 503 })).generate(input)).rejects.toMatchObject({ code: "THINKING_PROVIDER_UNAVAILABLE", status: 502 });
  });
});

describe("POST /api/v1/thinking/report", () => {
  it("returns only the batched report and rejects interview identifiers or unordered payloads before provider calls", async () => {
    const reportService = { generate: vi.fn(async () => ({ ...validReport, model: defaultThinkingModel, analysisVersion: "v2" as const })) };
    const app = createApp({ speechConfig, reportService });
    const success = await request(app).post("/api/v1/thinking/report").send(input);
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ ...validReport, model: defaultThinkingModel, analysisVersion: "v2" });
    expect(reportService.generate).toHaveBeenCalledWith(input);

    const withInterviewId = await request(app).post("/api/v1/thinking/report").send({ ...input, interviewId: "private-db-id" });
    expect(withInterviewId.status).toBe(400);
    const unordered = await request(app).post("/api/v1/thinking/report").send({ ...input, turns: [...input.turns].reverse() });
    expect(unordered.status).toBe(400);
    expect(reportService.generate).toHaveBeenCalledTimes(1);
  });

  it("rejects excessive answer count and aggregate payload size", async () => {
    const reportService = { generate: vi.fn() };
    const app = createApp({ speechConfig, reportService });
    const tooMany = await request(app).post("/api/v1/thinking/report").send({ ...input, turns: Array.from({ length: 31 }, (_, index) => ({ sequenceNumber: index + 1, question: "Q?", answer: "A." })) });
    expect(tooMany.status).toBe(400);
    const tooLarge = await request(app).post("/api/v1/thinking/report").send({ ...input, turns: Array.from({ length: 7 }, (_, index) => ({ sequenceNumber: index + 1, question: "Q?", answer: String(index).repeat(5_000) })) });
    expect(tooLarge.status).toBe(400);
    expect(reportService.generate).not.toHaveBeenCalled();
  });

  it("does not call the provider when no answers were submitted", async () => {
    const reportService = { generate: vi.fn() };
    const app = createApp({ speechConfig, reportService });
    const response = await request(app).post("/api/v1/thinking/report").send({ ...input, turns: [] });
    expect(response.status).toBe(400);
    expect(reportService.generate).not.toHaveBeenCalled();
  });

  it("returns a standardized configuration fallback", async () => {
    const app = createApp({ speechConfig, reportService: null });
    const response = await request(app).post("/api/v1/thinking/report").send(input);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("THINKING_NOT_CONFIGURED");
  });
});
