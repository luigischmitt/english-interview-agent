import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { createSpeculativeTurnController } from "../src/controllers/speculative-turn-controller.js";

const body = {
  revision: 1, currentQuestion: "Tell me about a project.", snapshot: "I built a service.", followUpUsed: false,
  askedQuestions: [], firstFixedQuestion: "Why this role?", secondFixedQuestion: null, firstFixedType: "job", secondFixedType: null,
  roleContext: { targetRole: "Backend Engineer" },
};

function fakeResponse() {
  const emitter = new EventEmitter() as EventEmitter & Record<string, unknown>;
  emitter.writableEnded = false;
  emitter.destroyed = false;
  emitter.sent = null;
  emitter.status = () => emitter;
  emitter.json = (payload: unknown) => { emitter.sent = payload; emitter.writableEnded = true; return emitter; };
  return emitter;
}

describe("speculative turn controller cancellation", () => {
  it("aborts the analysis when the client disconnects before the response", async () => {
    let received: AbortSignal | undefined;
    let finish!: () => void;
    const service = { analyze: (input: { signal?: AbortSignal }) => new Promise((resolve) => { received = input.signal; finish = () => resolve(null); }) };
    const request = new EventEmitter() as EventEmitter & { body: unknown };
    request.body = body;
    const response = fakeResponse();
    const handled = createSpeculativeTurnController(service as never, true)(request as never, response as never, () => {});
    await Promise.resolve();
    expect(received?.aborted).toBe(false);
    response.destroyed = true;
    response.emit("close");
    expect(received?.aborted).toBe(true);
    finish();
    await handled;
    expect(response.sent).toBeNull();
  });

  it("does not abort a completed analysis when the response closes normally", async () => {
    let received: AbortSignal | undefined;
    const service = { analyze: async (input: { signal?: AbortSignal }) => { received = input.signal; return null; } };
    const request = new EventEmitter() as EventEmitter & { body: unknown };
    request.body = body;
    const response = fakeResponse();
    await createSpeculativeTurnController(service as never, true)(request as never, response as never, () => {});
    response.emit("close");
    expect(received?.aborted).toBe(false);
    expect(response.sent).toEqual({ enabled: true, analysis: null });
  });
});
