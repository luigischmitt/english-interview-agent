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
  technicalContent: { summary: "Covers timeouts, retries, and basic monitoring.", strengths: ["Names bounded retries."], gaps: ["Does not describe retry limits or alert thresholds."] },
  englishCommunication: { clarity: "MOSTLY_CLEAR", patterns: [{ type: "GRAMMAR", evidence: "monitor errors", suggestion: "Use the simple present consistently." }] },
  priorities: [{ area: "TECHNICAL_CONTENT", focus: "Operational tradeoffs", exercise: "Explain when retries should stop in one minute." }],
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
      return providerResponse(JSON.stringify(validReport));
    });

    await expect(service.generate(input)).resolves.toEqual({ ...validReport, model: defaultThinkingModel, analysisVersion: "v1" });
    const body = requestBody as { provider: unknown; response_format: { json_schema: { strict: boolean; schema: { properties: Record<string, unknown> } } }; messages: Array<{ content: string }> };
    expect(body.provider).toEqual({ require_parameters: true, data_collection: "deny" });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties).not.toHaveProperty("score");
    expect(body.response_format.json_schema.schema.properties).not.toHaveProperty("internal_rationale");
    expect(body.messages[0].content).toContain("Do not infer vocal delivery");
    expect(JSON.parse(body.messages[1].content)).toEqual({ roleContext: input.roleContext, turns: input.turns });
  });

  it("rejects fabricated communication evidence and unsupported fields", async () => {
    const invalidEvidence = { ...validReport, englishCommunication: { ...validReport.englishCommunication, patterns: [{ ...validReport.englishCommunication.patterns[0], evidence: "not in any answer" }] } };
    await expect(makeService(async () => providerResponse(JSON.stringify(invalidEvidence))).generate(input))
      .rejects.toMatchObject({ code: "THINKING_INVALID_PROVIDER_RESPONSE", status: 502 });
    await expect(makeService(async () => providerResponse(JSON.stringify({ ...validReport, score: 94 }))).generate(input))
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
    const reportService = { generate: vi.fn(async () => ({ ...validReport, model: defaultThinkingModel, analysisVersion: "v1" as const })) };
    const app = createApp({ speechConfig, reportService });
    const success = await request(app).post("/api/v1/thinking/report").send(input);
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ ...validReport, model: defaultThinkingModel, analysisVersion: "v1" });
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

  it("returns a standardized configuration fallback", async () => {
    const app = createApp({ speechConfig, reportService: null });
    const response = await request(app).post("/api/v1/thinking/report").send(input);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("THINKING_NOT_CONFIGURED");
  });
});
