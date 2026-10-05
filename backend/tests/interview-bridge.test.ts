import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { defaultThinkingModel, defaultThinkingTimeoutMs, type ThinkingConfig } from "../src/thinking/config.js";
import { assignBridgeLeadIn, bridgeSystemPrompt, minBridgeBudgetMs, OpenRouterBridgeService, pickFallbackTransition, type BridgeInput } from "../src/thinking/interview-bridge-service.js";
import { createOrchestrationService, OpenRouterOrchestrationService } from "../src/thinking/openrouter-orchestration-service.js";
import type { InterviewOrchestrationInput } from "../src/thinking/types.js";
import type { SpeechConfig } from "../src/speech/config.js";

const speechConfig: SpeechConfig = { provider: "fake", kokoroBaseUrl: "http://localhost:8888", kokoroTimeoutMs: 1000, interviewerVoice: "af_bella", defaultSpeed: 1, format: "mp3" };
const config: ThinkingConfig = { openRouterApiKey: "server-test-key", model: defaultThinkingModel, timeoutMs: defaultThinkingTimeoutMs, orchestrationTimeoutMs: 6000, bridgeTimeoutMs: 400, diagnosticsEnabled: true };
const transcript = "We moved the billing service from a monolith to separate services because deploys were slow. I led the plan and we did it service by service over four months.";
const roleContext = { targetRole: "Backend Engineer" };
const followUpQuestion = "How did you decide which service to move first?";
const nextQuestion = "How do you monitor a production service?";

const decisionInput: InterviewOrchestrationInput = { currentQuestion: "Tell me about a technical decision.", transcript, nextFixedQuestion: nextQuestion, remainingFixedQuestions: [nextQuestion], askedQuestions: ["Tell me about a technical decision."], followUpUsed: false, roleContext };

function bridgeInput(overrides: Partial<BridgeInput> = {}): BridgeInput {
  return { decision: "FOLLOW_UP", currentQuestion: "Tell me about a technical decision.", transcript, question: followUpQuestion, roleContext, deadlineAt: Date.now() + 6000, ...overrides };
}

function chat(content: unknown, cost = 0.00002): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { cost }, model: defaultThinkingModel }));
}

function bridgeService(fetchImplementation: typeof fetch, overrides: Partial<ThinkingConfig> = {}) {
  return new OpenRouterBridgeService({ ...config, ...overrides }, fetchImplementation);
}

describe("interview bridge call", () => {
  it("sends a small strict JSON request with its own prompt and the assigned lead-in", async () => {
    let init: RequestInit | undefined;
    const result = await bridgeService(async (_url, options) => { init = options; return chat({ bridge: "So you moved the billing service to separate services because deploys were slow." }); }).write(bridgeInput({ recentAcknowledgements: ["I see."] }));
    expect(result).toMatchObject({ bridge: "So you moved the billing service to separate services because deploys were slow.", outcome: "generated", costUsd: 0.00002 });
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(defaultThinkingModel);
    expect(body.temperature).toBe(0.2);
    expect(body.provider).toEqual({ sort: "latency", require_parameters: true, data_collection: "deny" });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toEqual(["bridge"]);
    expect(body.messages[0].content).toBe(bridgeSystemPrompt);
    expect(bridgeSystemPrompt.length).toBeLessThanOrEqual(2100);
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ decision: "FOLLOW_UP", question: followUpQuestion, transcript, bridgeLeadIn: assignBridgeLeadIn(["I see."]), recentAcknowledgements: ["I see."] });
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer server-test-key");
  });

  it("accepts a grounded FOLLOW_UP bridge and reports whether the lead-in was followed", async () => {
    const result = await bridgeService(async () => chat({ bridge: "So you moved the billing service to separate services because deploys were slow" })).write(bridgeInput());
    expect(result).toMatchObject({ bridge: "So you moved the billing service to separate services because deploys were slow.", leadInFollowed: true });
    const other = await bridgeService(async () => chat({ bridge: "You led the plan for the billing service and did it service by service." })).write(bridgeInput());
    expect(other).toMatchObject({ outcome: "generated", leadInFollowed: false });
    expect(other.bridge).not.toBeNull();
  });

  it("accepts a grounded NEXT bridge with a short transition sentence", async () => {
    const bridge = "So you moved the billing service to separate services because deploys were slow. Let me ask about something different.";
    const result = await bridgeService(async () => chat({ bridge })).write(bridgeInput({ decision: "NEXT", question: nextQuestion }));
    expect(result).toMatchObject({ bridge, outcome: "generated", leadInFollowed: true });
    expect(result.transitionDropped).toBeUndefined();
  });

  it("accepts a topical NEXT transition that shares a word with the upcoming question and opens like a transition", async () => {
    const question = "How do you approach testing for the services you maintain?";
    const bridge = "So you moved the billing service to separate services because deploys were slow. Now I'd like to hear how you approach testing.";
    const result = await bridgeService(async () => chat({ bridge })).write(bridgeInput({ decision: "NEXT", question }));
    expect(result).toMatchObject({ bridge, outcome: "generated" });
    expect(result.transitionDropped).toBeUndefined();
    const switching = "So you moved the billing service to separate services because deploys were slow. Let's switch to how you handle testing.";
    await expect(bridgeService(async () => chat({ bridge: switching })).write(bridgeInput({ decision: "NEXT", question }))).resolves.toMatchObject({ bridge: switching });
  });

  it.each([
    ["does not open like a transition", "So you moved the billing service because deploys were slow. Testing matters for the services you maintain."],
    ["shares no word with the upcoming question", "So you moved the billing service because deploys were slow. I want to hear about your hobbies outside work."],
    ["is longer than 14 words", "So you moved the billing service because deploys were slow. Now I'd like to hear how you approach testing for all of the services you maintain."],
    ["names a different topic than the upcoming question", "So you moved the billing service because deploys were slow. Now I'd like to hear about your approach to monitoring."],
    ["names a topic that is also a restating verb", "So you moved the billing service because deploys were slow. Now I'd like to hear how you approach releases."],
  ])("drops only a NEXT transition that %s and keeps the restating sentence", async (_name, bridge) => {
    const result = await bridgeService(async () => chat({ bridge })).write(bridgeInput({ decision: "NEXT", question: "How do you approach testing for the services you maintain?" }));
    expect(result).toMatchObject({ bridge: "So you moved the billing service because deploys were slow.", outcome: "generated", transitionDropped: true });
  });

  it("keeps a generic NEXT transition that names no topic", async () => {
    const bridge = "So you moved the billing service because deploys were slow. Let me ask about something different.";
    await expect(bridgeService(async () => chat({ bridge })).write(bridgeInput({ decision: "NEXT", question: "How do you approach testing for the services you maintain?" }))).resolves.toMatchObject({ bridge });
  });

  it("drops a NEXT bridge whose transition repeats the upcoming question verbatim", async () => {
    const bridge = "So you moved the billing service because deploys were slow. Now how do you approach testing for services.";
    const result = await bridgeService(async () => chat({ bridge })).write(bridgeInput({ decision: "NEXT", question: "How do you approach testing for services?" }));
    expect(result).toMatchObject({ bridge: null, outcome: "dropped" });
  });

  it.each([
    ["an invented detail", "So you moved the billing service to Kubernetes because deploys were slow.", "invented_detail"],
    ["praise", "Great, you moved the billing service because deploys were slow.", "evaluative"],
    ["an inferred feeling", "So you felt worried about the billing service because deploys were slow.", "evaluative"],
    ["a bridge with a question mark", "So you moved the billing service because deploys were slow?", "not_one_sentence"],
    ["a second sentence for FOLLOW_UP", "So you moved the billing service. You did it because deploys were slow.", "not_one_sentence"],
    ["a generic bridge without any concrete detail", "Okay, so you did that.", "not_grounded"],
    ["a long copy of the transcript", "So you moved the billing service from a monolith to separate services because deploys were slow.", "copies_transcript"],
    ["a bridge that is too long for FOLLOW_UP", "So you moved the billing service from a monolith, because deploys were slow, and you led the plan, and you did it service by service, over four months.", "too_long"],
  ])("drops %s", async (_name, bridge, dropReason) => {
    const result = await bridgeService(async () => chat({ bridge })).write(bridgeInput());
    expect(result).toMatchObject({ bridge: null, outcome: "dropped", dropReason });
  });

  it("tolerates two paraphrased words when at least three substantive words come from the transcript", async () => {
    const bridge = "So you migrated the billing service to separate infrastructure because deploys were slow.";
    await expect(bridgeService(async () => chat({ bridge })).write(bridgeInput())).resolves.toMatchObject({ bridge, outcome: "generated" });
  });

  it("drops two missing words with only two overlapping ones, three missing words, and an invented proper noun", async () => {
    for (const bridge of ["So you migrated the billing service onto infrastructure.", "So you migrated the billing service onto infrastructure with automation because deploys were slow."]) {
      const result = await bridgeService(async () => chat({ bridge })).write(bridgeInput());
      expect(result).toMatchObject({ bridge: null, dropReason: "invented_detail" });
    }
    const proper = await bridgeService(async () => chat({ bridge: "So you migrated the billing service to Kubernetes because deploys were slow." })).write(bridgeInput());
    expect(proper).toMatchObject({ bridge: null, dropReason: "invented_detail" });
  });

  it("limits a FOLLOW_UP bridge to 16 words and a NEXT restating sentence to 18 words", async () => {
    const seventeenPlus = "So you moved the billing service to separate services because deploys were slow and you led it.";
    expect(seventeenPlus.split(" ").length).toBe(17);
    await expect(bridgeService(async () => chat({ bridge: seventeenPlus })).write(bridgeInput())).resolves.toMatchObject({ bridge: null, dropReason: "too_long" });
    const ok = "So you moved the billing service to separate services because deploys were slow.";
    expect(ok.split(" ").length).toBe(13);
    await expect(bridgeService(async () => chat({ bridge: ok })).write(bridgeInput())).resolves.toMatchObject({ bridge: ok });
    const longRestating = "So you moved the billing service from a monolith to separate services because deploys were slow and you led the plan. Let me ask about something different.";
    await expect(bridgeService(async () => chat({ bridge: longRestating })).write(bridgeInput({ decision: "NEXT", question: nextQuestion }))).resolves.toMatchObject({ bridge: null, dropReason: "too_long" });
  });

  it("capitalizes the first letter of a bridge", async () => {
    const result = await bridgeService(async () => chat({ bridge: "so you moved the billing service because deploys were slow" })).write(bridgeInput());
    expect(result.bridge).toBe("So you moved the billing service because deploys were slow.");
  });

  it("drops a bridge that repeats a recent acknowledgement", async () => {
    const result = await bridgeService(async () => chat({ bridge: "So you moved the billing service because deploys were slow." })).write(bridgeInput({ recentAcknowledgements: ["So you moved the billing service because deploys were slow!"] }));
    expect(result).toMatchObject({ bridge: null, outcome: "dropped", dropReason: "repeated_recent" });
  });

  it("drops a bridge whose question adds nothing new", async () => {
    const result = await bridgeService(async () => chat({ bridge: "So you moved the billing service because deploys were slow." })).write(bridgeInput({ question: "Why were deploys slow for the billing service you moved?" }));
    expect(result).toMatchObject({ bridge: null, dropReason: "redundant_with_question" });
  });

  it("keeps only the restating sentence when the NEXT question stays on the same detail", async () => {
    const bridge = "I understand you moved the billing service to separate services because deploys were slow. Now I'd like to switch to a different topic.";
    const result = await bridgeService(async () => chat({ bridge })).write(bridgeInput({ decision: "NEXT", question: "What was the hardest part of splitting the billing service into separate services?" }));
    expect(result).toMatchObject({ bridge: "I understand you moved the billing service to separate services because deploys were slow.", transitionDropped: true });
  });

  it("returns no bridge when the model answers null or an unusable shape", async () => {
    await expect(bridgeService(async () => chat({ bridge: null })).write(bridgeInput())).resolves.toMatchObject({ bridge: null, outcome: "generated" });
    await expect(bridgeService(async () => chat({ bridge: "x", extra: 1 })).write(bridgeInput())).resolves.toMatchObject({ bridge: null, outcome: "error" });
    await expect(bridgeService(async () => chat("not json")).write(bridgeInput())).resolves.toMatchObject({ bridge: null, outcome: "error" });
  });

  it("reports an error for provider failures and thrown fetches", async () => {
    await expect(bridgeService(async () => new Response("no", { status: 503 })).write(bridgeInput())).resolves.toMatchObject({ bridge: null, outcome: "error" });
    await expect(bridgeService(async () => { throw new Error("network down"); }).write(bridgeInput())).resolves.toMatchObject({ bridge: null, outcome: "error" });
    await expect(bridgeService(async () => chat({ bridge: null }), { openRouterApiKey: null }).write(bridgeInput())).resolves.toMatchObject({ outcome: "error" });
  });

  it("times out at its own limit and aborts the request", async () => {
    let aborted = false;
    const slow: typeof fetch = (_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
    });
    const started = Date.now();
    const result = await bridgeService(slow, { bridgeTimeoutMs: 300 }).write(bridgeInput());
    expect(result).toMatchObject({ bridge: null, outcome: "timeout" });
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("never outlives the remaining overall budget", async () => {
    const slow: typeof fetch = (_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
    const started = Date.now();
    const result = await bridgeService(slow, { bridgeTimeoutMs: 5000 }).write(bridgeInput({ deadlineAt: Date.now() + minBridgeBudgetMs + 100 }));
    expect(result.outcome).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(minBridgeBudgetMs + 600);
  });

  it("skips the call when less than 1200 ms of the deadline remains", async () => {
    const fetchImplementation = vi.fn();
    const result = await bridgeService(fetchImplementation).write(bridgeInput({ deadlineAt: Date.now() + minBridgeBudgetMs - 100 }));
    expect(result).toMatchObject({ bridge: null, outcome: "skipped_no_time" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("skips the call for a low-information transcript", async () => {
    const fetchImplementation = vi.fn();
    const result = await bridgeService(fetchImplementation).write(bridgeInput({ transcript: "Um, yeah. Maybe." }));
    expect(result).toMatchObject({ bridge: null, outcome: "skipped_low_info" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rotates the lead-in deterministically and avoids the last three", () => {
    expect(assignBridgeLeadIn([])).toBe("So you");
    expect(assignBridgeLeadIn([])).toBe(assignBridgeLeadIn([]));
    expect(assignBridgeLeadIn(["x"])).toBe("I understand you");
    const recent = ["So you chose X.", "Okay, so you did Y.", "I understand you did Z."];
    const picked = assignBridgeLeadIn(recent);
    for (const used of ["so you", "okay so", "i understand"]) expect(picked.toLowerCase().startsWith(used)).toBe(false);
    expect(assignBridgeLeadIn(recent)).toBe(picked);
  });

  it("rotates neutral transitions and avoids the recent ones", () => {
    const seen: string[] = [];
    for (let index = 0; index < 4; index += 1) seen.push(pickFallbackTransition(seen));
    expect(new Set(seen).size).toBe(4);
    expect(pickFallbackTransition(["Thanks for that. Let’s move on."])).not.toBe("Thanks for that. Let's move on.");
  });
});

describe("decision call is unchanged by the bridge step", () => {
  it("keeps the decision system prompt identical to the checked-in fixture", async () => {
    let system = "";
    await new OpenRouterOrchestrationService(config, async (_url, options) => { system = JSON.parse(String(options?.body)).messages[0].content; return new Response("{}", { status: 400 }); }, null).decide(decisionInput);
    expect(system).toBe(readFileSync(join(process.cwd(), "tests/fixtures/decision-system-prompt.txt"), "utf8").trimEnd());
  });
});

describe("next-turn flow with the bridge step", () => {
  afterEach(() => vi.restoreAllMocks());

  type Calls = { decision: number; bridge: number; bridgeBodies: Array<Record<string, unknown>> };
  const followUpDecision = { decision: "FOLLOW_UP", followUpQuestion, nextQuestion: null, anchor: "separate services", acknowledgement: "I see." };
  const nextDecision = { decision: "NEXT", followUpQuestion: null, nextQuestion, anchor: null, acknowledgement: null };
  const groundedFollowUp = "So you moved the billing service to separate services because deploys were slow.";
  const groundedNext = "I understand you moved the billing service to separate services because deploys were slow. Let me ask about something different.";

  function routedFetch(decision: unknown | (() => Response), bridge: unknown | (() => Promise<Response> | Response)) {
    const calls: Calls = { decision: 0, bridge: 0, bridgeBodies: [] };
    const fetchImplementation: typeof fetch = async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      if (body.response_format.json_schema.name === "interview_bridge") {
        calls.bridge += 1;
        calls.bridgeBodies.push(body);
        const pending = typeof bridge === "function" ? (bridge as () => Promise<Response> | Response)() : chat(bridge);
        // Like a real fetch, a pending request rejects when its signal aborts.
        return Promise.race([pending, new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))]);
      }
      calls.decision += 1;
      return typeof decision === "function" ? (decision as () => Response)() : chat(decision);
    };
    return { calls, fetchImplementation };
  }

  function logsOf(spy: ReturnType<typeof vi.spyOn>) {
    return spy.mock.calls.map((call) => JSON.parse(String(call[0]))).filter((entry) => entry.event === "interview_orchestration_decision");
  }

  it("uses a valid bridge for FOLLOW_UP in place of the decision's own acknowledgement", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { calls, fetchImplementation } = routedFetch(followUpDecision, { bridge: groundedFollowUp });
    const result = await new OpenRouterOrchestrationService(config, fetchImplementation).decide(decisionInput);
    expect(result).toMatchObject({ decision: "FOLLOW_UP", followUpQuestion, acknowledgement: groundedFollowUp });
    expect(result.diagnostics?.costUsd).toBeCloseTo(0.00004, 8);
    expect(calls).toMatchObject({ decision: 1, bridge: 1 });
    expect(calls.bridgeBodies[0].model).toBe(defaultThinkingModel);
    const [log] = logsOf(info);
    expect(log).toMatchObject({ bridge: "grounded", bridgeOutcome: "generated", leadInFollowed: true, decision: "FOLLOW_UP" });
    expect(typeof log.bridgeLatencyMs).toBe("number");
    expect(JSON.stringify(log)).not.toContain("billing");
  });

  it("keeps the decision's own acknowledgement when the FOLLOW_UP bridge is dropped, and logs the reason", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { fetchImplementation } = routedFetch(followUpDecision, { bridge: "Great, you moved the billing service because deploys were slow." });
    const result = await new OpenRouterOrchestrationService(config, fetchImplementation).decide(decisionInput);
    expect(result).toMatchObject({ decision: "FOLLOW_UP", followUpQuestion, acknowledgement: "I see." });
    expect(logsOf(info)[0]).toMatchObject({ bridge: "dropped", bridgeOutcome: "dropped", bridgeDropReason: "evaluative" });
  });

  it("returns a null FOLLOW_UP acknowledgement when neither exists", async () => {
    const { fetchImplementation } = routedFetch({ ...followUpDecision, acknowledgement: null }, { bridge: null });
    await expect(new OpenRouterOrchestrationService(config, fetchImplementation).decide(decisionInput)).resolves.toMatchObject({ decision: "FOLLOW_UP", acknowledgement: null });
  });

  it("adds a grounded bridge to a model NEXT and logs a dropped transition", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { fetchImplementation } = routedFetch(nextDecision, { bridge: groundedNext });
    const result = await new OpenRouterOrchestrationService(config, fetchImplementation).decide({ ...decisionInput, followUpUsed: true });
    expect(result).toMatchObject({ decision: "NEXT", nextQuestion, acknowledgement: groundedNext });
    expect(logsOf(info)[0]).toMatchObject({ bridge: "grounded", bridgeOutcome: "generated" });
    expect(logsOf(info)[0].transitionDropped).toBeUndefined();
  });

  it("falls back to a neutral rotating transition on NEXT when the bridge times out", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { fetchImplementation } = routedFetch(nextDecision, () => new Promise<Response>(() => undefined));
    const result = await new OpenRouterOrchestrationService({ ...config, bridgeTimeoutMs: 300 }, fetchImplementation).decide({ ...decisionInput, followUpUsed: true, recentAcknowledgements: ["Thanks for that. Let's move on."] });
    expect(result).toMatchObject({ decision: "NEXT", nextQuestion, acknowledgement: "Okay, let's move to a different topic." });
    expect(logsOf(info)[0]).toMatchObject({ bridge: "neutral", bridgeOutcome: "timeout" });
  });

  it("falls back to a neutral transition on NEXT when the bridge call errors or is invalid", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const errored = routedFetch(nextDecision, () => new Response("no", { status: 500 }));
    await expect(new OpenRouterOrchestrationService(config, errored.fetchImplementation).decide({ ...decisionInput, followUpUsed: true })).resolves.toMatchObject({ acknowledgement: "Thanks for that. Let's move on." });
    const invented = routedFetch(nextDecision, { bridge: "So you moved the billing service to Kubernetes because deploys were slow." });
    await expect(new OpenRouterOrchestrationService(config, invented.fetchImplementation).decide({ ...decisionInput, followUpUsed: true })).resolves.toMatchObject({ acknowledgement: "Thanks for that. Let's move on." });
    expect(logsOf(info).map((entry) => [entry.bridge, entry.bridgeOutcome, entry.bridgeDropReason])).toEqual([["neutral", "error", undefined], ["dropped", "dropped", "invented_detail"]]);
  });

  it("also bridges the deterministic fallback NEXT when the decision call fails", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { calls, fetchImplementation } = routedFetch(() => new Response("bad", { status: 400 }), { bridge: groundedNext });
    const result = await new OpenRouterOrchestrationService(config, fetchImplementation).decide(decisionInput);
    expect(result).toMatchObject({ decision: "NEXT", nextQuestion, acknowledgement: groundedNext });
    expect(calls.bridge).toBe(1);
    expect(logsOf(info)[0]).toMatchObject({ outcome: "fallback", reason: "provider_unavailable", bridge: "grounded" });
  });

  it("skips the bridge call and uses a neutral NEXT transition for a low-information transcript", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { calls, fetchImplementation } = routedFetch(nextDecision, { bridge: groundedNext });
    const result = await new OpenRouterOrchestrationService(config, fetchImplementation).decide({ ...decisionInput, transcript: "Um, yeah. Maybe." });
    expect(result).toMatchObject({ decision: "NEXT", nextQuestion, acknowledgement: "Thanks for that. Let's move on." });
    expect(calls).toMatchObject({ decision: 0, bridge: 0 });
    expect(logsOf(info)[0]).toMatchObject({ reason: "low_information", bridge: "neutral", bridgeOutcome: "skipped_low_info" });
  });

  it("returns a null acknowledgement and makes no bridge call when no question is left", async () => {
    const { calls, fetchImplementation } = routedFetch(() => new Response("bad", { status: 400 }), { bridge: groundedNext });
    const result = await new OpenRouterOrchestrationService(config, fetchImplementation).decide({ ...decisionInput, nextFixedQuestion: null, remainingFixedQuestions: [] });
    expect(result).toEqual({ decision: "NEXT", followUpQuestion: null, nextQuestion: null, acknowledgement: null, diagnostics: undefined });
    expect(calls.bridge).toBe(0);
  });

  it("skips the bridge when too little of the overall deadline is left after a slow decision", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const slowDecision = async () => { await new Promise((resolve) => setTimeout(resolve, 450)); return chat(nextDecision); };
    const { calls, fetchImplementation } = routedFetch(slowDecision, { bridge: groundedNext });
    const result = await new OpenRouterOrchestrationService({ ...config, orchestrationTimeoutMs: 1500, orchestrationHedgeAfterMs: 0 }, fetchImplementation).decide({ ...decisionInput, followUpUsed: true });
    expect(result.acknowledgement).toBe("Thanks for that. Let's move on.");
    expect(calls.bridge).toBe(0);
    expect(logsOf(info)[0]).toMatchObject({ bridge: "neutral", bridgeOutcome: "skipped_no_time" });
  });

  it("serves the bridged decision through POST /api/v1/thinking/next-turn", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { fetchImplementation } = routedFetch(followUpDecision, { bridge: groundedFollowUp });
    const app = createApp({ speechConfig, orchestrationService: createOrchestrationService({ ...config, diagnosticsEnabled: false }, fetchImplementation) });
    const response = await request(app).post("/api/v1/thinking/next-turn").send({ ...decisionInput, recentAcknowledgements: ["x".repeat(200)] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ decision: "FOLLOW_UP", followUpQuestion, nextQuestion: null, acknowledgement: groundedFollowUp });
    const tooLong = await request(app).post("/api/v1/thinking/next-turn").send({ ...decisionInput, recentAcknowledgements: ["x".repeat(221)] });
    expect(tooLong.status).toBe(400);
  });
});
