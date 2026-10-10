import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenRouterPlannedCoverageService, plannedCoverageSystemPrompt } from "../src/thinking/planned-coverage-service.js";

const reply = (content: unknown, init: ResponseInit = { status: 200 }, usage?: unknown) => new Response(JSON.stringify({ choices: [{ message: { content } }], ...(usage ? { usage } : {}) }), init);
const service = (fetchImplementation: typeof fetch, timeoutMs = 1_500) => new OpenRouterPlannedCoverageService({ apiKey: "SENTINEL-KEY-9", model: "test/model", timeoutMs }, fetchImplementation);
const input = { plannedQuestion: "Which metrics do you use?", candidateAnswers: ["Earlier answer.", "I use precision and recall."] };

afterEach(() => vi.restoreAllMocks());

describe("OpenRouterPlannedCoverageService", () => {
  it("sends a strict private request and logs a content-free timing event", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => reply('{"coverage":"COVERED"}', undefined, { prompt_tokens: 80, completion_tokens: 5, cost: 0.00001 }));
    await expect(service(fetchMock as unknown as typeof fetch).classify(input)).resolves.toBe("COVERED");
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.temperature).toBe(0);
    expect(body.provider).toEqual({ sort: "latency", require_parameters: true, data_collection: "deny" });
    expect(body.response_format.json_schema.schema).toMatchObject({ required: ["coverage"], additionalProperties: false });
    expect(body.messages[0]).toEqual({ role: "system", content: plannedCoverageSystemPrompt });
    expect(JSON.parse(body.messages[1].content)).toEqual(input);
    const logged = String(info.mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toMatchObject({ event: "interview_planned_coverage", outcome: "success", coverage: "COVERED", promptTokens: 80, costUsd: 0.00001 });
    expect(logged).not.toContain("metrics");
    expect(logged).not.toContain("SENTINEL");
  });

  it.each([["not json"], ['{"coverage":"MAYBE"}'], ['{"coverage":"OPEN","extra":1}'], ["{}"], ["[]"], [null]])("rejects invalid content %j", async (content) => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(service((async () => reply(content)) as unknown as typeof fetch).classify(input)).rejects.toMatchObject({ kind: "error" });
  });

  it("reports provider failure, timeout and abort", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(service((async () => new Response("no", { status: 503 })) as unknown as typeof fetch).classify(input)).rejects.toMatchObject({ kind: "error" });
    const hanging = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => { init.signal!.addEventListener("abort", () => reject(new Error("aborted"))); })) as unknown as typeof fetch;
    await expect(service(hanging, 50).classify(input)).rejects.toMatchObject({ kind: "timeout" });
    const controller = new AbortController();
    const pending = service(hanging).classify({ ...input, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "error" });
    expect(info.mock.calls.map((call) => JSON.parse(String(call[0])).outcome)).toEqual(["error", "timeout", "aborted"]);
  });
});
