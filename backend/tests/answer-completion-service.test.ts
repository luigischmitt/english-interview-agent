import { afterEach, describe, expect, it, vi } from "vitest";

import { AnswerCompletionError, OpenRouterAnswerCompletionService, answerCompletionSystemPrompt } from "../src/thinking/answer-completion-service.js";

const sentinelKey = "SENTINEL-OPENROUTER-KEY-4c1d";
const reply = (content: unknown, init: ResponseInit = { status: 200 }, usage?: unknown) => new Response(JSON.stringify({ choices: [{ message: { content } }], ...(usage ? { usage } : {}) }), init);
const service = (fetchImplementation: typeof fetch, timeoutMs = 1_500) => new OpenRouterAnswerCompletionService({ apiKey: sentinelKey, model: "test/model", timeoutMs }, fetchImplementation);
const input = { question: "Tell me about a hard bug.", answer: "I fixed a race condition by adding a lock." };

afterEach(() => vi.restoreAllMocks());

describe("OpenRouterAnswerCompletionService", () => {
  it("sends a strict, private, deterministic request and returns the verdict", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => reply('{"complete":true}', undefined, { prompt_tokens: 91, completion_tokens: 7, cost: 0.00002, prompt_tokens_details: { cached_tokens: 40 } }));
    await expect(service(fetchMock as unknown as typeof fetch).isComplete(input)).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${sentinelKey}`);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("test/model");
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBeLessThanOrEqual(32);
    expect(body.usage).toEqual({ include: true });
    expect(body.provider).toEqual({ sort: "latency", require_parameters: true, data_collection: "deny" });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema).toMatchObject({ required: ["complete"], additionalProperties: false, properties: { complete: { type: "boolean" } } });
    expect(body.messages[0]).toEqual({ role: "system", content: answerCompletionSystemPrompt });
    expect(JSON.parse(body.messages[1].content)).toEqual(input);
    expect(init.body).not.toContain(sentinelKey);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({ event: "interview_answer_completion_timing", promptTokens: 91, completionTokens: 7, costUsd: 0.00002, cachedTokens: 40 });
  });

  it("returns false verdicts", async () => {
    await expect(service((async () => reply('{"complete":false}')) as unknown as typeof fetch).isComplete(input)).resolves.toBe(false);
  });

  it.each(["OPEN", "COVERED", "INVALID"] as const)("classifies a follow-up candidate as %s without changing completion", async (candidateCompatibility) => {
    const fetchMock = vi.fn(async () => reply(JSON.stringify({ complete: false, candidateCompatibility })));
    const result = await service(fetchMock as unknown as typeof fetch).assess({ ...input, candidate: { question: "What made the lock safe?", anchor: "a lock" } });
    expect(result).toEqual({ complete: false, candidateCompatibility });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.response_format.json_schema.schema.required).toEqual(["complete", "candidateCompatibility"]);
    expect(body.provider.data_collection).toBe("deny");
  });

  it.each([["not json"], ['{"complete":"yes"}'], ['{"complete":true,"extra":1}'], ["[]"], [null], [42]])("rejects invalid content %j as an error", async (content) => {
    await expect(service((async () => reply(content)) as unknown as typeof fetch).isComplete(input)).rejects.toMatchObject({ kind: "error" });
  });

  it("rejects provider failures as errors", async () => {
    await expect(service((async () => new Response("nope", { status: 503 })) as unknown as typeof fetch).isComplete(input)).rejects.toMatchObject({ kind: "error" });
    await expect(service((async () => { throw new Error("network"); }) as unknown as typeof fetch).isComplete(input)).rejects.toBeInstanceOf(AnswerCompletionError);
  });

  it("times out and aborts the provider call", async () => {
    let aborted = false;
    const hanging = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
    })) as unknown as typeof fetch;
    await expect(service(hanging, 50).isComplete(input)).rejects.toMatchObject({ kind: "timeout" });
    expect(aborted).toBe(true);
  });

  it("aborts with the caller signal without reporting a timeout", async () => {
    const hanging = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = service(hanging).isComplete({ ...input, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "error" });
  });

  it("never logs the key, the question or the answer, including in errors", async () => {
    const spies = [vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "log")].map((spy) => spy.mockImplementation(() => undefined));
    const error = await service((async () => { throw new Error(`boom ${sentinelKey}`); }) as unknown as typeof fetch).isComplete(input).catch((caught: Error) => caught);
    expect((error as Error).message).not.toContain(sentinelKey);
    expect((error as Error).message).not.toContain("race condition");
    expect(spies[0]).toHaveBeenCalledOnce();
    for (const spy of spies.slice(1)) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(spies.flatMap((spy) => spy.mock.calls))).not.toMatch(/SENTINEL|race condition|hard bug/);
  });

  it("states the conservative rules in the prompt", () => {
    expect(answerCompletionSystemPrompt).toMatch(/When unsure/);
    expect(answerCompletionSystemPrompt).toMatch(/untrusted data/);
  });
});
