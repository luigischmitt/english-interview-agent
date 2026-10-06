import { describe, expect, it, vi } from "vitest";

import { defaultThinkingModel } from "../src/thinking/config.js";
import { OpenRouterInterviewReportService } from "../src/thinking/openrouter-interview-report-service.js";
import { hasDegenerateWhitespace } from "../src/thinking/report-degeneration.js";

const roleContext = { targetRole: "Software Engineer", seniority: "junior", focus: "mixed" };
const turn = { sequenceNumber: 9, question: "What made the tool return false values?", answer: "Because my LLM generated a false code in my backend." };
const loop = `{"technicalStrengths": [],${"\t".repeat(3000)}`;
const valid = { technicalStrengths: [], technicalGaps: [], englishPatterns: [] };

function response(content: string, provider: string, finish: string): Response {
  return new Response(JSON.stringify({ provider, choices: [{ finish_reason: finish, message: { content } }] }), { status: 200 });
}
function service(fetchImplementation: typeof fetch) {
  return new OpenRouterInterviewReportService({ key: "k", model: defaultThinkingModel, timeoutMs: 60000, turnTimeoutMs: 60000, fetchImplementation });
}

describe("degenerate whitespace output", () => {
  it("detects whitespace runs only outside strings", () => {
    expect(hasDegenerateWhitespace(loop)).toBe(true);
    expect(hasDegenerateWhitespace(JSON.stringify({ a: " ".repeat(100) }))).toBe(false);
    expect(hasDegenerateWhitespace(JSON.stringify(valid, null, 2))).toBe(false);
  });

  it("does not retry a degenerate per-turn result", async () => {
    const bodies: Array<Record<string, any>> = [];
    const responses = [response(loop, "Parasail", "length"), response(JSON.stringify(valid), "Other", "stop")];
    const fetchImplementation: typeof fetch = async (_u, init) => { bodies.push(JSON.parse(String(init?.body))); return responses.shift()!; };
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(service(fetchImplementation).analyzeTurn({ roleContext, turn })).rejects.toMatchObject({ code: "THINKING_INVALID_PROVIDER_RESPONSE" });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.provider.ignore).toBeUndefined();
    const logged = info.mock.calls.map(([e]) => String(e)).join("\n");
    expect(logged).toContain("invalid_provider_response");
    expect(logged).not.toContain("Parasail");
    expect(logged).not.toContain("LLM generated");
    info.mockRestore();
  });

  it("caps configured per-turn timeout overrides and logs content-free outcomes", async () => {
    let calls = 0;
    let sentSignal: AbortSignal | undefined;
    const fetchImplementation: typeof fetch = async (_url, init) => { calls += 1; sentSignal = init?.signal as AbortSignal; return response(JSON.stringify(valid), "Other", "stop"); };
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const configured = new OpenRouterInterviewReportService({ key: "k", model: defaultThinkingModel, timeoutMs: 60000, turnTimeoutMs: 60_000, fetchImplementation });
    try {
      await configured.analyzeTurn({ roleContext, turn });
      expect(calls).toBe(1);
      expect(sentSignal).toBeDefined();
      expect(info.mock.calls.map(([entry]) => String(entry)).join("\n")).toContain('"event":"interview_report_turn_outcome","outcome":"success"');
    } finally { info.mockRestore(); }
  });
});
