import { describe, expect, it, vi } from "vitest";
import { SpeculativeTurnAnalysisService } from "../src/thinking/speculative-turn-analysis-service.js";

const input = { revision: 2, currentQuestion: "What did you build?", snapshot: "I built a Kafka pipeline and reduced latency.", followUpUsed: false, askedQuestions: [], firstFixedQuestion: "How do you monitor services in production?", secondFixedQuestion: "How do you test changes?", firstFixedType: "bank" as const, secondFixedType: "job" as const, previousCandidate: null, roleContext: { targetRole: "Backend Engineer" } };

function logged(info: ReturnType<typeof vi.spyOn>) {
  return info.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>).find((entry) => entry.event === "interview_speculative_analysis");
}

describe("speculative analysis abort classification", () => {
  it("classifies a request timeout as timeout, not invalid_json", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }));
      await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 30 }, fetcher as unknown as typeof fetch).analyze(input)).resolves.toBeNull();
      expect(logged(info)).toMatchObject({ outcome: "timeout", reason: "timeout" });
    } finally { info.mockRestore(); }
  });

  it("classifies an abort while reading the body as timeout, not invalid_json", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = new ReadableStream({ start(controller) { init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true }); } });
        return new Response(body, { status: 200 });
      });
      await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 30 }, fetcher as unknown as typeof fetch).analyze(input)).resolves.toBeNull();
      expect(logged(info)).toMatchObject({ outcome: "timeout", reason: "timeout" });
    } finally { info.mockRestore(); }
  });

  it("keeps invalid_json for a genuinely malformed body", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const fetcher = vi.fn(async () => new Response("not json", { status: 200 }));
      await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher as unknown as typeof fetch).analyze(input)).resolves.toBeNull();
      expect(logged(info)).toMatchObject({ reason: "invalid_json" });
    } finally { info.mockRestore(); }
  });

  it("sends previousCandidate to the model so KEEP is possible", async () => {
    const previousCandidate = { question: "How did Kafka help?", anchor: "Kafka" };
    const content = { revision: 2, followUpAction: "KEEP", followUpQuestion: previousCandidate.question, followUpAnchor: previousCandidate.anchor, fixedAction: "FIXED_KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null, secondFixedAction: "FIXED_KEEP", adaptedSecondFixedQuestion: null, secondFixedEvidenceAnchor: null };
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 }));
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher as unknown as typeof fetch).analyze({ ...input, previousCandidate });
    expect(result).toMatchObject({ followUpAction: "KEEP", followUpQuestion: previousCandidate.question });
    const body = JSON.parse(String((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]?.body));
    expect(JSON.parse(body.messages[1].content).previousCandidate).toEqual(previousCandidate);
    expect(body.response_format.json_schema.schema.properties.followUpAction.enum).toContain("KEEP");
  });
});
