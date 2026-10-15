import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

import { createPolishedAnswerController } from "../controllers/polished-answer-controller.js";
import { OpenRouterPolishedAnswerService } from "./polished-answer-service.js";

const input = { question: "Tell me about a challenge.", answer: "I worked in a team and we fixed the slow search by adding an index to the database." };

function fetchWith(content: unknown) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(request.temperature).toBe(0);
    expect(request.provider).toMatchObject({ data_collection: "deny" });
    expect(request.response_format).toMatchObject({ type: "json_schema" });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
  }) as typeof fetch;
}

describe("OpenRouterPolishedAnswerService", () => {
  it("returns a grounded polished answer and key changes", async () => {
    const service = new OpenRouterPolishedAnswerService({ key: "test", model: "test-model", fetchImplementation: fetchWith({
      polishedAnswer: "I worked on a team, and we fixed the slow search by adding an index to the database.",
      keyChanges: [{ from: "worked in a team", to: "worked on a team", note: "Ajuste de preposição." }],
    }) });
    await expect(service.polish(input)).resolves.toEqual({
      polishedAnswer: "I worked on a team, and we fixed the slow search by adding an index to the database.",
      keyChanges: [{ from: "worked in a team", to: "worked on a team", note: "Ajuste de preposição." }],
      model: "test-model",
    });
  });

  it("drops key changes whose from text is not literal answer evidence", async () => {
    const service = new OpenRouterPolishedAnswerService({ key: "test", model: "test-model", fetchImplementation: fetchWith({
      polishedAnswer: input.answer,
      keyChanges: [{ from: "I led a team", to: "I worked on a team", note: "Improved phrasing." }],
    }) });
    const result = await service.polish(input);
    expect(result.keyChanges).toEqual([]);
  });

  it("rejects a polished answer that introduces a number", async () => {
    const service = new OpenRouterPolishedAnswerService({ key: "test", model: "test-model", fetchImplementation: fetchWith({
      polishedAnswer: "I worked in a team of 12 and we fixed the slow search by adding an index to the database.", keyChanges: [],
    }) });
    await expect(service.polish(input)).rejects.toMatchObject({ code: "THINKING_INVALID_PROVIDER_RESPONSE", status: 502 });
  });

  it("returns HTTP 422 for a low-content answer without calling OpenRouter", async () => {
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const service = new OpenRouterPolishedAnswerService({ key: "test", model: "test-model", fetchImplementation });
    const request = Object.assign(new EventEmitter(), { body: { ...input, answer: "I used AWS." } });
    let status = 0;
    let body: unknown;
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      destroyed: false,
      status(code: number) { status = code; return this; },
      json(value: unknown) { body = value; return this; },
    });
    await createPolishedAnswerController(service)(request as never, response as never, vi.fn());
    expect(status).toBe(422);
    expect(body).toEqual({ error: { code: "ANSWER_TOO_SHORT_TO_POLISH", message: "This answer needs more detail before it can be polished." } });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
