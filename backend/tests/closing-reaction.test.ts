import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { defaultThinkingModel, defaultThinkingTimeoutMs, type ThinkingConfig } from "../src/thinking/config.js";
import { closingReactionSystemPrompt, OpenRouterClosingReactionService } from "../src/thinking/closing-reaction-service.js";
import type { SpeechConfig } from "../src/speech/config.js";

const speechConfig: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://localhost:8888", kokoroTimeoutMs: 1000, interviewerVoice: "af_bella", defaultSpeed: 1, format: "mp3" };
const config: ThinkingConfig = { openRouterApiKey: "server-test-key", model: defaultThinkingModel, timeoutMs: defaultThinkingTimeoutMs, orchestrationTimeoutMs: 6000, bridgeTimeoutMs: 400, diagnosticsEnabled: true };
const transcript = "We traced the slow responses to the cache TTL, so I shortened it and the latency dropped by half.";
const input = { currentQuestion: "Tell me about a performance problem you solved.", transcript };

const chat = (bridge: unknown, cost = 0.00002) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ bridge }) } }], usage: { prompt_tokens: 120, completion_tokens: 15, cost } }));
const service = (fetchImplementation: typeof fetch) => new OpenRouterClosingReactionService(config, fetchImplementation);

afterEach(() => vi.restoreAllMocks());

describe("closing reaction service", () => {
  it("sends a strict, privacy-safe request and returns a grounded reaction", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let init: RequestInit | undefined;
    const result = await service(async (_url, options) => { init = options; return chat("So you traced the slow responses to the cache TTL."); }).react({ ...input, recentAcknowledgements: ["I see."] });
    expect(result).toEqual({ reaction: "So you traced the slow responses to the cache TTL.", outcome: "generated" });
    const body = JSON.parse(String(init?.body));
    expect(body.usage).toEqual({ include: true });
    expect(body.provider).toEqual({ sort: "latency", require_parameters: true, data_collection: "deny" });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[0].content).toBe(closingReactionSystemPrompt);
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ currentQuestion: input.currentQuestion, transcript, recentAcknowledgements: ["I see."] });
    const line = String(info.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: "interview_closing_reaction", outcome: "generated", reaction: true, costUsd: 0.00002, promptTokens: 120 });
    expect(line).not.toContain("cache TTL");
    expect(line).not.toContain(input.currentQuestion);
  });

  it.each([
    ["praise", "Great job tracing the slow responses to the cache TTL.", "evaluative"],
    ["invented detail", "So you moved the service to Kubernetes with Redis clusters.", "invented_detail"],
    ["a question", "So you traced it to the cache TTL?", "not_one_sentence"],
    ["too long", "So you traced the slow responses to the cache TTL and then you shortened it so that the latency dropped by half.", "too_long"],
    ["a repeated reaction", "So you traced the slow responses to the cache TTL.", "repeated_recent"],
  ])("drops %s", async (_label, reaction, dropReason) => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const recentAcknowledgements = dropReason === "repeated_recent" ? ["So you traced the slow responses to the cache TTL."] : [];
    const result = await service(async () => chat(reaction)).react({ ...input, recentAcknowledgements });
    expect(result).toEqual({ reaction: null, outcome: "dropped", dropReason });
  });

  it("returns null for a null bridge, low information, provider errors, malformed output and timeouts", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect((await service(async () => chat(null)).react(input)).reaction).toBeNull();
    expect((await service(async () => chat("anything")).react({ ...input, transcript: "Um, yes." })).outcome).toBe("skipped_low_info");
    expect((await service(async () => new Response("{}", { status: 500 })).react(input)).outcome).toBe("error");
    expect((await service(async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }))).react(input)).outcome).toBe("error");
    const hanging = (async (_url: unknown, options?: RequestInit) => new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    expect((await new OpenRouterClosingReactionService({ ...config, bridgeTimeoutMs: 300 }, hanging).react(input)).outcome).toBe("timeout");
    const controller = new AbortController();
    const pending = service(hanging).react({ ...input, signal: controller.signal });
    controller.abort();
    expect((await pending).outcome).toBe("cancelled");
  });
});

describe("POST /api/v1/thinking/closing-reaction", () => {
  const appWith = (reactionService: Parameters<typeof createApp>[0] extends infer T ? T extends { closingReactionService?: infer S } ? S : never : never) => createApp({ speechConfig, accessTokenVerifier: null, closingReactionService: reactionService });

  it("returns the reaction for a valid request", async () => {
    const react = vi.fn(async () => ({ reaction: "So you traced it to the cache TTL.", outcome: "generated" as const }));
    const response = await request(appWith({ react })).post("/api/v1/thinking/closing-reaction").send({ ...input, recentAcknowledgements: ["I see."], roleContext: { targetRole: "Backend Engineer" } });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: true, reaction: "So you traced it to the cache TTL." });
    expect(react).toHaveBeenCalledWith(expect.objectContaining({ currentQuestion: input.currentQuestion, transcript, recentAcknowledgements: ["I see."] }));
  });

  it("reports a disabled service without failing", async () => {
    const response = await request(appWith(null)).post("/api/v1/thinking/closing-reaction").send(input);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: false, reaction: null });
  });

  it.each([
    [{}],
    [{ currentQuestion: "Q?", transcript: "" }],
    [{ currentQuestion: "", transcript }],
    [{ ...input, transcript: "x".repeat(10_001) }],
    [{ ...input, recentAcknowledgements: "nope" }],
    [{ ...input, recentAcknowledgements: [1] }],
    [{ ...input, roleContext: { targetRole: "x".repeat(121) } }],
  ])("rejects invalid input %#", async (body) => {
    const react = vi.fn();
    const response = await request(appWith({ react })).post("/api/v1/thinking/closing-reaction").send(body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_CLOSING_REACTION");
    expect(react).not.toHaveBeenCalled();
  });
});
