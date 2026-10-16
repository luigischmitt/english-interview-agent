import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createRedoCheckController } from "../controllers/redo-check-controller.js";
import { createRedoCheckService } from "./redo-check-service.js";
import type { ThinkingConfig } from "./config.js";

const config: ThinkingConfig = { openRouterApiKey: "test-key", model: "test-model", timeoutMs: 15_000, orchestrationTimeoutMs: 6_000, diagnosticsEnabled: false };
const input = { question: "How did you resolve it?", originalPatterns: [{ type: "GRAMMAR" as const, evidence: "in the weekend", rephrasedExample: "on the weekend" }], newAnswer: "I fixed it on the weekend." };

describe("redo check", () => {
  it("sends strict, private JSON schema request and validates the comparison", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patterns: [{ evidence: "in the weekend", fixed: true, note: "Esse padrão não reapareceu." }] }) } }] }), { status: 200 }));
    const service = createRedoCheckService(config, fetcher);
    await expect(service.check(input)).resolves.toEqual({ patterns: [{ evidence: "in the weekend", fixed: true, note: "Esse padrão não reapareceu." }] });
    const [, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.temperature).toBe(0);
    expect(body.provider.data_collection).toBe("deny");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[1].content).toContain(input.newAnswer);
  });

  it("exposes POST /redo-check and rejects malformed payloads", async () => {
    const service = createRedoCheckService(config, vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ patterns: [{ evidence: "in the weekend", fixed: true, note: "Não reapareceu." }] }) } }] }), { status: 200 })));
    const handler = createRedoCheckController(service);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn(), once: vi.fn(), off: vi.fn(), writableEnded: false, destroyed: false } as unknown as Response;
    const validRequest = { body: input, once: vi.fn(), off: vi.fn() } as unknown as Request;
    await handler(validRequest, response, vi.fn());
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ patterns: [{ evidence: "in the weekend", fixed: true, note: "Não reapareceu." }] });
    const invalidResponse = { ...response, status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    await handler({ ...validRequest, body: { ...input, extra: true } } as unknown as Request, invalidResponse, vi.fn());
    expect(invalidResponse.status).toHaveBeenCalledWith(400);
  });
});
