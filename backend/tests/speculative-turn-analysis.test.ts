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
    expect(body.response_format.json_schema.schema.properties.followUpAction.enum).toEqual(["REPLACE", "NONE"]);
    expect(body.messages[0].content).toContain("KEEP is forbidden");
  });

  it("allows KEEP only when a prior candidate exists and logs only content-free diagnostics", async () => {
    const previousCandidate = { question: "How did Kafka help?", anchor: "Kafka" };
    const fetcher = response({ revision: 2, followUpAction: "KEEP", followUpQuestion: previousCandidate.question, followUpAnchor: previousCandidate.anchor, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, previousCandidate });
      expect(result?.followUpAction).toBe("KEEP");
      const body = JSON.parse(String((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]?.body));
      expect(body.response_format.json_schema.schema.properties.followUpAction.enum).toEqual(["KEEP", "REPLACE", "NONE"]);
      const diagnostic = JSON.parse(String(info.mock.calls[0]?.[0]));
      expect(diagnostic).toMatchObject({ revision: 2, hadPreviousCandidate: true, followUpSelected: true });
      expect(String(info.mock.calls[0]?.[0])).not.toContain(previousCandidate.question);
      expect(String(info.mock.calls[0]?.[0])).not.toContain(input.snapshot);
    } finally {
      info.mockRestore();
    }
  });

  it("drops only a follow-up whose anchor is absent from the snapshot", async () => {
    const fetcher = response({ revision: 2, followUpAction: "REPLACE", followUpQuestion: "Why did Redis help?", followUpAnchor: "Redis", fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze(input)).resolves.toEqual({
      revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null,
    });
  });

  it("drops a follow-up that asks about a different detail than its literal anchor", async () => {
    const fetcher = response({ revision: 2, followUpAction: "REPLACE", followUpQuestion: "Why did you choose Redis for this project?", followUpAnchor: "Kafka pipeline", fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze(input)).resolves.toMatchObject({ followUpAction: "NONE", fixedAction: "KEEP" });
  });

  it("never allows SKIP for a job question and never calls after follow-up use", async () => {
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "SKIP", adaptedFixedQuestion: null, fixedEvidenceAnchor: "Kafka pipeline" });
    const service = new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher);
    await expect(service.analyze({ ...input, firstFixedType: "job" })).resolves.toMatchObject({ fixedAction: "KEEP" });
    await expect(service.analyze({ ...input, followUpUsed: true })).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows a covered resume question to be skipped and forwards eight prior answer pairs", async () => {
    const previousAnswers = Array.from({ length: 8 }, (_, index) => ({ question: `Question ${index}?`, answer: `Answer ${index}.` }));
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "SKIP", adaptedFixedQuestion: null, fixedEvidenceAnchor: "Kafka pipeline" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, firstFixedType: "resume", firstFixedQuestion: "Tell me about a project you worked on?", previousAnswers });
    expect(result).toMatchObject({ fixedAction: "SKIP", fixedEvidenceAnchor: "Kafka pipeline" });
    const body = JSON.parse(String((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]?.body));
    expect(body.messages[1].content).toContain('"previousAnswers"');
    expect(JSON.parse(body.messages[1].content).previousAnswers).toHaveLength(8);
    expect(body.messages[0].content).toContain("specific question just because its general topic or project was mentioned");
  });

  it("deterministically skips a broad project question after a substantive project answer", async () => {
    const snapshot = "In my last role, I built a Kafka pipeline for payment events with three teammates. I designed the retry strategy, monitored it in Grafana, and reduced processing latency by forty percent after the launch.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({
      ...input,
      snapshot,
      firstFixedType: "resume",
      firstFixedQuestion: "What was one project you worked on?",
    });
    expect(result).toMatchObject({ fixedAction: "SKIP", fixedEvidenceAnchor: "built a Kafka pipeline for payment events with" });
  });

  it("does not infer project coverage from a short passing mention", async () => {
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({
      ...input,
      snapshot: "I built a Kafka pipeline there.",
      firstFixedType: "resume",
      firstFixedQuestion: "What was one project you worked on?",
    });
    expect(result).toMatchObject({ fixedAction: "KEEP", fixedEvidenceAnchor: null });
  });

  it("does not classify a specific project challenge question as a broad introduction", async () => {
    const snapshot = "In my last role, I built a Kafka pipeline for payment events with three teammates. I designed the retry strategy, monitored it in Grafana, and reduced processing latency by forty percent after the launch.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({
      ...input,
      snapshot,
      firstFixedType: "resume",
      firstFixedQuestion: "What was the project's main challenge?",
    });
    expect(result).toMatchObject({ fixedAction: "KEEP", fixedEvidenceAnchor: null });
  });

  it("rejects skipping a specific bank question merely because its project was mentioned", async () => {
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "SKIP", adaptedFixedQuestion: null, fixedEvidenceAnchor: "Kafka pipeline" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, firstFixedType: "bank", firstFixedQuestion: "Tell me about a decision you made for the project." });
    expect(result).toMatchObject({ fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
  });

  it("does not treat a shared build verb as proof that a specific question was covered", async () => {
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "SKIP", adaptedFixedQuestion: null, fixedEvidenceAnchor: "Kafka pipeline" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({
      ...input,
      currentQuestion: "What did you build?",
      firstFixedQuestion: "How did you build the API?",
    });
    expect(result).toMatchObject({ fixedAction: "KEEP", fixedEvidenceAnchor: null });
  });

  it("allows skipping a bank question that repeats an already asked competency", async () => {
    const repeated = "How did you monitor services in production?";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "SKIP", adaptedFixedQuestion: null, fixedEvidenceAnchor: "Kafka pipeline" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, firstFixedType: "bank", firstFixedQuestion: repeated, askedQuestions: [repeated] });
    expect(result).toMatchObject({ fixedAction: "SKIP", fixedEvidenceAnchor: "Kafka pipeline" });
  });

  it("keeps a specific fixed competency and deepens it with an unexplored supported angle", async () => {
    const snapshot = "I built a Kafka pipeline. We used Grafana alerts to detect spikes before customer impact.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "DEEPEN", adaptedFixedQuestion: "How did you monitor service health before customer impact?", fixedEvidenceAnchor: "Grafana alerts" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, snapshot, currentQuestion: "What did you build?", firstFixedQuestion: "How did you monitor services in production?" });
    expect(result).toMatchObject({ fixedAction: "DEEPEN", adaptedFixedQuestion: "How did you monitor service health before customer impact?", fixedEvidenceAnchor: "Grafana alerts" });
  });

  it("rejects a DEEPEN rewrite that repeats a question already asked", async () => {
    const repeatedQuestion = "How did you monitor services in production?";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "DEEPEN", adaptedFixedQuestion: repeatedQuestion, fixedEvidenceAnchor: "Kafka pipeline" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, firstFixedQuestion: repeatedQuestion, askedQuestions: [repeatedQuestion] });
    expect(result).toMatchObject({ fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
  });

  it("repairs harmless provider field mistakes without losing a grounded follow-up", async () => {
    const fetcher = response({
      revision: 3,
      followUpAction: "REPLACE",
      followUpQuestion: "How did the Kafka pipeline reduce latency?",
      followUpAnchor: "kafka pipeline",
      fixedAction: "KEEP",
      adaptedFixedQuestion: input.firstFixedQuestion,
      fixedEvidenceAnchor: null,
    });
    await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze(input)).resolves.toEqual({
      revision: 2,
      followUpAction: "REPLACE",
      followUpQuestion: "How did the Kafka pipeline reduce latency?",
      followUpAnchor: "Kafka pipeline",
      fixedAction: "KEEP",
      adaptedFixedQuestion: null,
      fixedEvidenceAnchor: null,
    });
  });
});
