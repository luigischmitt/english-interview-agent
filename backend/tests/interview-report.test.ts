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
  technicalContent: {
    summary: "Covers bounded retries and basic monitoring.",
    strengths: [{ sequenceNumber: 2, evidence: "bounded retries", explanation: "Nomeia uma proteção para tentativas repetidas." }],
    gaps: [{ sequenceNumber: 4, evidence: "monitor errors", explanation: "A resposta não explica limites ou alertas." }],
  },
  englishCommunication: {
    clarity: "MOSTLY_CLEAR", evidenceStatus: "LIMITED",
    patterns: [{ type: "GRAMMAR", sequenceNumber: 4, evidence: "monitor errors", suggestion: "Use o presente simples de forma consistente.", rephrasedExample: "We monitor errors and latency." }],
  },
  priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 4, evidence: "errors and latency", focus: "Limites de alerta", exercise: "Explique em um minuto quais limites acionariam um alerta." }],
};
const providerReport = {
  ...validReport,
  englishCommunication: { clarity: validReport.englishCommunication.clarity, patterns: validReport.englishCommunication.patterns },
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
    expect(body.messages[0].content).toContain("cite the sequenceNumber and a short exact contiguous excerpt from that answer");
    expect(body.messages[0].content).toContain("include a concrete, corrected English rephrasing grounded in that answer");
    expect(JSON.parse(body.messages[1].content)).toEqual({ roleContext: input.roleContext, turns: input.turns });
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
    expect(report.englishCommunication.evidenceStatus).toBe("INSUFFICIENT");
  });

  it("preserves complete user-facing sentences", async () => {
    const report = await makeService(async () => providerResponse(JSON.stringify(providerReport))).generate(input);

    expect(report).toMatchObject(validReport);
    expect(report.technicalContent.summary).toBe(validReport.technicalContent.summary);
    expect(report.technicalContent.strengths).toEqual(validReport.technicalContent.strengths);
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
