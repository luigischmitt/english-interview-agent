import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { SpeechConfig } from "../src/speech/config.js";
import { defaultThinkingModel, defaultThinkingTimeoutMs } from "../src/thinking/config.js";
import { OpenRouterOrchestrationService } from "../src/thinking/openrouter-orchestration-service.js";
import type { InterviewOrchestrationInput } from "../src/thinking/types.js";

const speechConfig: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://localhost:8888", kokoroTimeoutMs: 1000, interviewerVoice: "af_bella", defaultSpeed: 1, format: "mp3" };
const currentQuestion = "How would you make a REST API reliable?";
const base: InterviewOrchestrationInput = {
  currentQuestion,
  transcript: "Can you repeat the question?",
  nextFixedQuestion: "How do you monitor a production service?",
  remainingFixedQuestions: ["How do you monitor a production service?"],
  askedQuestions: ["Tell me about a difficult technical decision.", currentQuestion],
  followUpUsed: false,
  roleContext: { targetRole: "Backend Engineer", seniority: "mid-level", focus: "reliability" },
};
const nulls = { followUpQuestion: null, nextQuestion: null, anchor: null, acknowledgement: null };

function providerResponse(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost: 0.00003 }, model: defaultThinkingModel }), { status: 200 });
}

function service(fetchImplementation: typeof fetch) {
  return new OpenRouterOrchestrationService({ openRouterApiKey: "server-test-key", model: defaultThinkingModel, timeoutMs: defaultThinkingTimeoutMs, orchestrationTimeoutMs: 1000, diagnosticsEnabled: true }, fetchImplementation, null);
}

function decisionLogs(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls.map((call) => String(call[0])).map((line) => JSON.parse(line)).filter((entry) => entry.event === "interview_orchestration_decision");
}

afterEach(() => vi.restoreAllMocks());

describe("clarification requests in the next-turn decision", () => {
  it("answers a detected repeat request locally without calling the model", async () => {
    const fetchMock = vi.fn(async () => providerResponse({}));
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await service(fetchMock as unknown as typeof fetch).decide({ ...base, clarificationHint: "repeat" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ decision: "REPEAT", followUpQuestion: null, nextQuestion: null, acknowledgement: null, clarificationText: null, clarification: "detector" });
    expect(decisionLogs(spy)).toEqual([expect.objectContaining({ decision: "REPEAT", clarification: "detector", reason: "detector_repeat", outcome: "accepted" })]);
  });

  it("accepts a simpler rephrase of the same question and logs it without any text", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const text = "What would you do to keep a REST API working when things fail?";
    const result = await service(async () => providerResponse({ decision: "REPHRASE", ...nulls, clarificationText: text })).decide({ ...base, transcript: "I didn't understand the question.", clarificationHint: "rephrase" });
    expect(result).toMatchObject({ decision: "REPHRASE", clarificationText: text, clarification: "detector", followUpQuestion: null, nextQuestion: null });
    const logs = decisionLogs(spy);
    expect(logs).toEqual([expect.objectContaining({ decision: "REPHRASE", clarification: "detector", outcome: "accepted", reason: "model_decision" })]);
    expect(JSON.stringify(logs)).not.toMatch(/REST API|understand/);
  });

  it("accepts a one-sentence definition of a term", async () => {
    const text = "Scalability is how well a system keeps working when it gets more users or data.";
    const result = await service(async () => providerResponse({ decision: "DEFINE", ...nulls, clarificationText: text })).decide({ ...base, transcript: "What do you mean by scalability?", clarificationHint: "define" });
    expect(result).toMatchObject({ decision: "DEFINE", clarificationText: text, clarification: "detector" });
  });

  it("lets the model choose a clarification without a hint for a short utterance (clarification: model)", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const result = await service(async () => providerResponse({ decision: "REPEAT", ...nulls, clarificationText: null })).decide({ ...base, transcript: "Sorry, I lost the thread, which part do you want?" });
    expect(result).toMatchObject({ decision: "REPEAT", clarification: "model" });
    expect(decisionLogs(spy)[0]).toMatchObject({ clarification: "model", decision: "REPEAT" });
  });

  it("never treats a long real answer as a clarification, even if the model says so", async () => {
    const answer = "I would repeat the failed request with exponential backoff and jitter, and I would add an idempotency key so that the same payment is never charged twice by accident.";
    const result = await service(async () => providerResponse({ decision: "REPEAT", ...nulls, clarificationText: null })).decide({ ...base, transcript: answer });
    expect(result).toMatchObject({ decision: "NEXT", nextQuestion: "How do you monitor a production service?" });
  });

  it("rejects an invalid rephrase or definition and repeats the question instead of moving on", async () => {
    const invalid = [
      { decision: "REPHRASE", ...nulls, clarificationText: "Tell me about databases." },
      { decision: "REPHRASE", ...nulls, clarificationText: "Great question, what would you do to keep a REST API reliable?" },
      { decision: "REPHRASE", ...nulls, clarificationText: "x".repeat(230) + "?" },
      { decision: "REPHRASE", ...nulls, clarificationText: null },
      { decision: "DEFINE", ...nulls, clarificationText: `${"Scalability means growth ".repeat(8)}.` },
      { decision: "DEFINE", ...nulls, clarificationText: "In your project, scalability meant adding more servers." },
      { decision: "DEFINE", ...nulls, clarificationText: "What is scalability anyway?" },
      { decision: "REPEAT", ...nulls, followUpQuestion: "Why retries?", clarificationText: null },
      { decision: "NEXT", ...nulls, nextQuestion: "How do you monitor reliability in production systems?", clarificationText: null },
      { decision: "FOLLOW_UP", ...nulls, followUpQuestion: "What limit would you set for retries?", anchor: "bounded retries", clarificationText: null },
    ];
    for (const raw of invalid) {
      const result = await service(async () => providerResponse(raw)).decide({ ...base, transcript: "What do you mean by scalability?", clarificationHint: "define" });
      expect(result).toMatchObject({ decision: "REPEAT", clarificationText: null, clarification: "detector" });
    }
  });

  it("repeats the question when the provider fails or there is no key for a hinted request", async () => {
    await expect(service(async () => new Response("{}", { status: 400 })).decide({ ...base, transcript: "Could you rephrase that?", clarificationHint: "rephrase" })).resolves.toMatchObject({ decision: "REPEAT" });
    const noKey = new OpenRouterOrchestrationService({ openRouterApiKey: null, model: defaultThinkingModel, timeoutMs: 1000, orchestrationTimeoutMs: 1000, diagnosticsEnabled: false }, vi.fn() as unknown as typeof fetch, null);
    await expect(noKey.decide({ ...base, transcript: "Sorry", clarificationHint: "rephrase" })).resolves.toMatchObject({ decision: "REPEAT", clarification: "detector" });
  });

  it("a rephrase identical to the current question becomes a repeat", async () => {
    const result = await service(async () => providerResponse({ decision: "REPHRASE", ...nulls, clarificationText: currentQuestion })).decide({ ...base, transcript: "I did not understand", clarificationHint: "rephrase" });
    expect(result).toMatchObject({ decision: "REPEAT", clarificationText: null });
  });

  it("still works after the follow-up is spent and does not run the bridge step", async () => {
    const bridge = { write: vi.fn() };
    const orchestration = new OpenRouterOrchestrationService({ openRouterApiKey: "k", model: defaultThinkingModel, timeoutMs: 1000, orchestrationTimeoutMs: 1000, diagnosticsEnabled: false }, async () => providerResponse({ decision: "REPEAT", ...nulls, clarificationText: null }), bridge);
    await expect(orchestration.decide({ ...base, followUpUsed: true, transcript: "Sorry, can you say that again?", clarificationHint: "repeat" })).resolves.toMatchObject({ decision: "REPEAT" });
    await expect(orchestration.decide({ ...base, followUpUsed: true, transcript: "I didn't get the question.", clarificationHint: "rephrase" })).resolves.toMatchObject({ decision: "REPEAT" });
    expect(bridge.write).not.toHaveBeenCalled();
  });

  it("tells the model about clarification requests and sends the hint", async () => {
    let body: Record<string, unknown> = {};
    await service(async (_url, options) => { body = JSON.parse(String(options?.body)); return providerResponse({ decision: "REPEAT", ...nulls, clarificationText: null }); }).decide({ ...base, transcript: "Sorry, what?", clarificationHint: "rephrase" });
    const messages = body.messages as Array<{ content: string }>;
    const system = messages[0].content;
    expect(system).toContain("Clarification requests:");
    expect(system).toContain("it is NOT an answer: never choose FOLLOW_UP or NEXT for it");
    expect(system).toContain("Never choose REPEAT, REPHRASE, or DEFINE for a real answer");
    expect(system).toContain("at most 160 characters");
    expect(system).toContain("When clarificationHint is not null");
    expect(JSON.parse(messages[1].content)).toMatchObject({ clarificationHint: "rephrase" });
    const properties = (body.response_format as { json_schema: { schema: { properties: Record<string, { enum?: string[] }> } } }).json_schema.schema.properties;
    expect(properties.decision.enum).toEqual(["FOLLOW_UP", "NEXT", "REPEAT", "REPHRASE", "DEFINE"]);
  });

  it("rejects a hinted request answered with a normal question and repeats instead", async () => {
    const result = await service(async () => providerResponse({ decision: "NEXT", ...nulls, nextQuestion: "How do you monitor reliability in production systems?", clarificationText: null })).decide({ ...base, transcript: "I don't understand the question", clarificationHint: "rephrase" });
    expect(result).toMatchObject({ decision: "REPEAT", clarification: "detector" });
  });
});

describe("clarificationHint over HTTP", () => {
  const body = { ...base, clarificationHint: "define" };
  it("passes a valid hint to the service and rejects an unknown one", async () => {
    const decide = vi.fn(async () => ({ decision: "REPEAT" as const, followUpQuestion: null, nextQuestion: null, acknowledgement: null }));
    const app = createApp({ speechConfig, orchestrationService: { decide } });
    const ok = await request(app).post("/api/v1/thinking/next-turn").send(body);
    expect(ok.status).toBe(200);
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ clarificationHint: "define" }));
    const bad = await request(app).post("/api/v1/thinking/next-turn").send({ ...base, clarificationHint: "nope" });
    expect(bad.status).toBe(400);
    await request(app).post("/api/v1/thinking/next-turn").send({ ...base, clarificationHint: null });
    expect(decide).toHaveBeenLastCalledWith(expect.not.objectContaining({ clarificationHint: expect.anything() }));
  });
});
