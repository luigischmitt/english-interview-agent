import { describe, expect, it, vi } from "vitest";
import { SpeculativeTurnAnalysisService } from "../src/thinking/speculative-turn-analysis-service.js";

const input = { revision: 2, currentQuestion: "What did you build?", snapshot: "I built a Kafka pipeline and reduced latency.", followUpUsed: false, askedQuestions: [], firstFixedQuestion: "How do you monitor services in production?", secondFixedQuestion: "How do you test changes?", firstFixedType: "bank" as const, secondFixedType: "job" as const, previousCandidate: null, roleContext: { targetRole: "Backend Engineer", seniority: "senior" } };
const response = (analysis: object) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0001 } }), { status: 200 }));

describe("speculative turn analysis", () => {
  it("accepts a grounded replacement and sends privacy-safe routing", async () => {
    const fetcher = response({ revision: 2, followUpAction: "REPLACE", followUpQuestion: "How did Kafka reduce the latency?", followUpAnchor: "Kafka pipeline", fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze(input);
    expect(result?.followUpAction).toBe("REPLACE");
    const body = JSON.parse(String((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]?.body));
    expect(body.usage).toEqual({ include: true });
    expect(body.provider.data_collection).toBe("deny");
  });

  it("rejects an anchor absent from the snapshot", async () => {
    const fetcher = response({ revision: 2, followUpAction: "REPLACE", followUpQuestion: "Why did Redis help?", followUpAnchor: "Redis", fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze(input)).resolves.toBeNull();
  });

  it("never allows SKIP for a job question and never calls after follow-up use", async () => {
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "SKIP", adaptedFixedQuestion: null, fixedEvidenceAnchor: "Kafka pipeline" });
    const service = new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher);
    await expect(service.analyze({ ...input, firstFixedType: "job" })).resolves.toBeNull();
    await expect(service.analyze({ ...input, followUpUsed: true })).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
