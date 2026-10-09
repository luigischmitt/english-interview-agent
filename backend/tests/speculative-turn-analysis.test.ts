import { describe, expect, it, vi } from "vitest";
import { SpeculativeTurnAnalysisService } from "../src/thinking/speculative-turn-analysis-service.js";

const input = { revision: 2, currentQuestion: "What did you build?", snapshot: "I built a Kafka pipeline and reduced latency.", followUpUsed: false, askedQuestions: [], firstFixedQuestion: "How do you monitor services in production?", secondFixedQuestion: "How do you test changes?", firstFixedType: "bank" as const, secondFixedType: "job" as const, previousCandidate: null, roleContext: { targetRole: "Backend Engineer", seniority: "senior" } };
const response = (analysis: Record<string, unknown>) => {
  const providerAction = (value: unknown) => typeof value === "string" ? `FIXED_${value}` : value;
  const providerAnalysis = { ...analysis, fixedAction: providerAction(analysis.fixedAction), secondFixedAction: providerAction(analysis.secondFixedAction ?? "KEEP"), adaptedSecondFixedQuestion: analysis.adaptedSecondFixedQuestion ?? null, secondFixedEvidenceAnchor: analysis.secondFixedEvidenceAnchor ?? null };
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerAnalysis) } }], usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.0001 } }), { status: 200 }));
};
const rawResponse = (content: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }));

describe("speculative turn analysis", () => {
  it("accepts a grounded replacement and sends privacy-safe routing", async () => {
    const fetcher = response({ revision: 2, followUpAction: "REPLACE", followUpQuestion: "How did Kafka reduce the latency?", followUpAnchor: "Kafka pipeline", fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze(input);
    expect(result?.followUpAction).toBe("REPLACE");
    const body = JSON.parse(String((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]?.body));
    expect(body.usage).toEqual({ include: true });
    expect(body.provider.data_collection).toBe("deny");
    expect(body.response_format.json_schema.schema.properties.followUpAction.enum).toEqual(["REPLACE", "NONE"]);
    expect(body.response_format.json_schema.schema.properties.fixedAction.enum).toEqual(["FIXED_KEEP", "FIXED_SKIP", "FIXED_DEEPEN"]);
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

  it("trusts a model KEEP of a previous candidate; later coverage is the backend compatibility check's job (changed: no longer cleared by word overlap)", async () => {
    const fetcher = response({ revision: 2, followUpAction: "KEEP", followUpQuestion: "What result did the retry policy produce?", followUpAnchor: "retry policy", fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({
      ...input,
      snapshot: "The retry policy reduced duplicate charges by forty percent after rollout.",
      previousCandidate: { question: "What result did the retry policy produce?", anchor: "retry policy" },
    });
    expect(result).toMatchObject({ followUpAction: "KEEP", followUpQuestion: "What result did the retry policy produce?", followUpAnchor: "retry policy" });
  });

  it("keeps a grounded previous candidate that shares anchor words with the snapshot (Redis)", async () => {
    const previousCandidate = { question: "Why did you choose Redis for the user sessions?", anchor: "Redis" };
    const fetcher = response({ revision: 2, followUpAction: "KEEP", followUpQuestion: previousCandidate.question, followUpAnchor: previousCandidate.anchor, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, snapshot: "We cached the user sessions in Redis to cut latency.", previousCandidate });
    expect(result).toMatchObject({ followUpAction: "KEEP", followUpQuestion: previousCandidate.question, followUpAnchor: "Redis" });
  });

  it("drops only a follow-up whose anchor is absent from the snapshot", async () => {
    const fetcher = response({ revision: 2, followUpAction: "REPLACE", followUpQuestion: "Why did Redis help?", followUpAnchor: "Redis", fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze(input)).resolves.toEqual({
      revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null, secondFixedAction: "KEEP", adaptedSecondFixedQuestion: null, secondFixedEvidenceAnchor: null,
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

  it("never allows SKIP for a second planned job question", async () => {
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null, secondFixedAction: "SKIP", adaptedSecondFixedQuestion: null, secondFixedEvidenceAnchor: "monitored service health" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, snapshot: "We monitored service health with Grafana alerts.", secondFixedQuestion: "How did you monitor service health?", secondFixedType: "job" });
    // Changed: the generated "What would you improve in the way you ..." template is gone; a model SKIP of a job question keeps it unchanged.
    expect(result).toMatchObject({ secondFixedAction: "KEEP", adaptedSecondFixedQuestion: null, secondFixedEvidenceAnchor: null });
  });

  it("keeps a covered first job question unchanged when the provider returns KEEP (changed: no forced template DEEPEN)", async () => {
    const snapshot = "We monitored service health in production with Grafana alerts and reviewed every incident weekly.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, snapshot, firstFixedType: "job", firstFixedQuestion: "How did you monitor service health in production?" });
    expect(result).toMatchObject({ fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
  });

  it("accepts a valid model DEEPEN of a covered job question and never skips it", async () => {
    const snapshot = "We monitored service health in production with Grafana alerts and reviewed every incident weekly.";
    const base = { revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null };
    const deepen = response({ ...base, fixedAction: "DEEPEN", adaptedFixedQuestion: "How did you monitor Grafana alerts without too much noise?", fixedEvidenceAnchor: "Grafana alerts" });
    const common = { ...input, snapshot, firstFixedType: "job" as const, firstFixedQuestion: "How did you monitor service health in production?" };
    await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, deepen).analyze(common)).resolves.toMatchObject({ fixedAction: "DEEPEN", adaptedFixedQuestion: "How did you monitor Grafana alerts without too much noise?" });
    const skip = response({ ...base, fixedAction: "SKIP", adaptedFixedQuestion: null, fixedEvidenceAnchor: "monitored service health" });
    await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, skip).analyze(common)).resolves.toMatchObject({ fixedAction: "KEEP" });
  });

  it("never emits broken template English for job questions that merely overlap by chance", async () => {
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const service = new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher);
    await expect(service.analyze({ ...input, snapshot: "I am interested in this role at Acme because of the product.", firstFixedType: "job", firstFixedQuestion: "Why are you interested in this role at Acme?" })).resolves.toMatchObject({ fixedAction: "KEEP", adaptedFixedQuestion: null });
    await expect(service.analyze({ ...input, snapshot: "I have used Kubernetes clusters for staging and described the experience to my team.", firstFixedType: "job", firstFixedQuestion: "Describe your experience with Kubernetes clusters?" })).resolves.toMatchObject({ fixedAction: "KEEP", adaptedFixedQuestion: null });
  });

  it("allows a covered resume question to be skipped and forwards eight prior answer pairs", async () => {
    const previousAnswers = Array.from({ length: 8 }, (_, index) => ({ question: `Question ${index}?`, answer: `Answer ${index}.` }));
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "SKIP", adaptedFixedQuestion: null, fixedEvidenceAnchor: "Kafka pipeline" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, firstFixedType: "resume", firstFixedQuestion: "Tell me about a project you worked on?", previousAnswers });
    expect(result).toMatchObject({ fixedAction: "SKIP", fixedEvidenceAnchor: "Kafka pipeline" });
    const body = JSON.parse(String((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]?.body));
    expect(body.messages[1].content).toContain('"previousAnswers"');
    expect(JSON.parse(body.messages[1].content).previousAnswers).toHaveLength(8);
      expect(body.messages[0].content).toContain("project-name overlap is insufficient");
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

  it("recognizes another-project wording as a broad question after substantive project work", async () => {
    const snapshot = "I designed and built a payments service with Kafka and PostgreSQL. I led the rollout, implemented reconciliation alerts, coordinated support, measured duplicate charges, and improved the retry policy after production incidents.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, snapshot, firstFixedQuestion: "Tell me about another project you built?" });
    expect(result).toMatchObject({ fixedAction: "SKIP" });
  });

  it("skips a specific non-job competency only when the model says SKIP and its anchor contains the competency (changed: model SKIP now required)", async () => {
    const snapshot = "I coached two engineers through code reviews and weekly design sessions, helping them own releases independently.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "SKIP", adaptedFixedQuestion: null, fixedEvidenceAnchor: "coached two engineers through code reviews" });
    const service = new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher);
    await expect(service.analyze({ ...input, snapshot, firstFixedQuestion: "How did you mentor engineers and help them grow?" })).resolves.toMatchObject({ fixedAction: "SKIP" });
    await expect(service.analyze({ ...input, snapshot: "I built the payments service with Kafka and PostgreSQL and led its rollout.", firstFixedQuestion: "How did you resolve duplicate messages during the payments migration?" })).resolves.toMatchObject({ fixedAction: "KEEP" });
  });

  describe("specific question coverage never overrides the model", () => {
    const run = (analysis: Record<string, unknown>, overrides: Record<string, unknown>) => new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null, ...analysis })).analyze({ ...input, hasThirdFixedQuestion: true, ...overrides } as typeof input);
    it.each([
      ["payments challenge vs mere project mention", "What was the biggest technical challenge in your payments migration?", "Last year I worked on the payments migration at my company and it took six months."],
      ["handle/team stop-words", "How do you handle disagreements with your team?", "I usually handle the backend services for my team."],
      ["have/junior shared words", "How have you mentored junior developers?", "I have worked with junior developers in a squad of six."],
    ])("keeps the question when only generic words overlap: %s", async (_label, firstFixedQuestion, snapshot) => {
      await expect(run({}, { snapshot, firstFixedType: "bank", firstFixedQuestion })).resolves.toMatchObject({ fixedAction: "KEEP", fixedEvidenceAnchor: null });
    });
    it.each([
      ["monitoring explained with tools and thresholds", "How do you monitor a service in production?", "I built the reconciliation worker. For monitoring, I added Grafana dashboards for queue lag and error rate, and PagerDuty alerts when lag passed five minutes."],
      ["mentoring explained with a routine and a result", "How have you mentored junior developers?", "I mentor two junior developers every week: we pair on code reviews, I set learning goals with them, and after three months one of them started leading small features alone."],
    ])("turns a model KEEP into SKIP when the competency was explained in depth: %s", async (_label, firstFixedQuestion, snapshot) => {
      await expect(run({}, { snapshot, firstFixedType: "bank", firstFixedQuestion })).resolves.toMatchObject({ fixedAction: "SKIP" });
    });
    it.each([
      ["tests only mentioned", "How do you decide what to test?", "We moved from a monolith to services and I was responsible for the billing API and its tests."],
      ["monitoring only mentioned", "How do you monitor a service in production?", "I worked on the billing service and we also had some monitoring there."],
    ])("keeps a model KEEP when the competency is only mentioned: %s", async (_label, firstFixedQuestion, snapshot) => {
      await expect(run({}, { snapshot, firstFixedType: "bank", firstFixedQuestion })).resolves.toMatchObject({ fixedAction: "KEEP" });
    });
    it("skips a covered specific question when the model DEEPEN is rejected (it would be asked verbatim)", async () => {
      const snapshot = "For monitoring, I added Grafana dashboards for queue lag and error rate, and PagerDuty alerts when lag passed five minutes.";
      await expect(run({ fixedAction: "DEEPEN", adaptedFixedQuestion: "Tell me more?", fixedEvidenceAnchor: "not in the answer" }, { snapshot, firstFixedType: "bank", firstFixedQuestion: "How do you monitor a service in production?" })).resolves.toMatchObject({ fixedAction: "SKIP" });
    });
    it("never turns a covered job question or a model DEEPEN into SKIP", async () => {
      const snapshot = "For monitoring, I added Grafana dashboards for queue lag and error rate, and PagerDuty alerts when lag passed five minutes.";
      await expect(run({}, { snapshot, firstFixedType: "job", firstFixedQuestion: "How do you monitor a service in production?" })).resolves.toMatchObject({ fixedAction: "KEEP" });
      await expect(run({ fixedAction: "DEEPEN", adaptedFixedQuestion: "How would you monitor the queue lag if the traffic doubled?", fixedEvidenceAnchor: "PagerDuty alerts when lag passed five minutes" }, { snapshot, firstFixedType: "bank", firstFixedQuestion: "How do you monitor a service in production?" })).resolves.toMatchObject({ fixedAction: "DEEPEN" });
    });
    it("preserves a valid model DEEPEN instead of a heuristic SKIP", async () => {
      const result = await run({ fixedAction: "DEEPEN", adaptedFixedQuestion: "What was the hardest technical challenge when you migrated the payments data?", fixedEvidenceAnchor: "payments migration" }, { snapshot: "Last year I worked on the payments migration at my company and it took six months.", firstFixedType: "bank", firstFixedQuestion: "What was the biggest technical challenge in your payments migration?" });
      expect(result).toMatchObject({ fixedAction: "DEEPEN" });
    });
    it("rejects a model SKIP whose anchor shares only the topic or generic words", async () => {
      const result = await run({ fixedAction: "SKIP", fixedEvidenceAnchor: "worked on the payments migration" }, { snapshot: "Last year I worked on the payments migration at my company.", firstFixedType: "bank", firstFixedQuestion: "What was the biggest technical challenge in your payments migration?" });
      expect(result).toMatchObject({ fixedAction: "KEEP", fixedEvidenceAnchor: null });
    });
    it("does not let a negated or hedged mention bypass the check, even with a model SKIP", async () => {
      const snapshot = "Honestly I am not sure, but in general I mentor junior developers sometimes.";
      const kept = await run({}, { snapshot, firstFixedType: "bank", firstFixedQuestion: "How have you mentored junior developers?" });
      expect(kept).toMatchObject({ fixedAction: "KEEP" });
      const modelSkip = await run({ fixedAction: "SKIP", fixedEvidenceAnchor: "I mentor junior developers sometimes" }, { snapshot, firstFixedType: "bank", firstFixedQuestion: "How have you mentored junior developers?" });
      expect(modelSkip).toMatchObject({ fixedAction: "KEEP" });
    });
    it("allows SKIP when mentoring is actually explained and the model says SKIP", async () => {
      const snapshot = "I mentor two juniors every week: we pair on code reviews and I set learning goals with them.";
      const result = await run({ fixedAction: "SKIP", fixedEvidenceAnchor: "I mentor two juniors every week" }, { snapshot, firstFixedType: "bank", firstFixedQuestion: "How have you mentored junior developers?" });
      expect(result).toMatchObject({ fixedAction: "SKIP", fixedEvidenceAnchor: "I mentor two juniors every week" });
    });
    it("requires an explanation of the solution for challenge questions", async () => {
      const snapshot = "The hardest part was the data migration. We solved it by dual-writing and verifying checksums nightly.";
      const question = "What was the hardest part of the payments migration?";
      await expect(run({ fixedAction: "SKIP", fixedEvidenceAnchor: "The hardest part was the data migration" }, { snapshot, firstFixedType: "bank", firstFixedQuestion: question })).resolves.toMatchObject({ fixedAction: "SKIP" });
      await expect(run({ fixedAction: "SKIP", fixedEvidenceAnchor: "The hardest part was the data migration" }, { snapshot: "The hardest part was the data migration.", firstFixedType: "bank", firstFixedQuestion: question })).resolves.toMatchObject({ fixedAction: "KEEP" });
    });
    it("applies the same rule to the second question and requires a third question", async () => {
      const snapshot = "Last year I worked on the payments migration at my company. I mentor two juniors every week: we pair on code reviews.";
      const second = (anchor: string, secondFixedQuestion: string, extra: Record<string, unknown> = {}) => run({ secondFixedAction: "SKIP", secondFixedEvidenceAnchor: anchor }, { snapshot, secondFixedType: "bank", secondFixedQuestion, ...extra });
      await expect(second("worked on the payments migration", "What was the hardest part of the payments migration?")).resolves.toMatchObject({ secondFixedAction: "KEEP", secondFixedEvidenceAnchor: null });
      await expect(second("I mentor two juniors every week", "How do you mentor junior developers?")).resolves.toMatchObject({ secondFixedAction: "SKIP" });
      await expect(second("I mentor two juniors every week", "How do you mentor junior developers?", { hasThirdFixedQuestion: false })).resolves.toMatchObject({ secondFixedAction: "KEEP", secondFixedEvidenceAnchor: null });
    });
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

  it("does not accept an evidence anchor found only in a previous question", async () => {
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "SKIP", adaptedFixedQuestion: null, fixedEvidenceAnchor: "Grafana monitoring" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({
      ...input,
      firstFixedQuestion: "How did you monitor services in production?",
      previousAnswers: [{ question: "How did Grafana monitoring work?", answer: "I would rather discuss another topic." }],
    });
    expect(result).toMatchObject({ fixedAction: "KEEP", fixedEvidenceAnchor: null });
  });

  it("keeps a specific fixed competency and deepens it with an unexplored supported angle", async () => {
    const snapshot = "I built a Kafka pipeline. We used Grafana alerts to detect spikes before customer impact.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "DEEPEN", adaptedFixedQuestion: "How did you monitor service health before customer impact?", fixedEvidenceAnchor: "Grafana alerts" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, snapshot, currentQuestion: "What did you build?", firstFixedQuestion: "How did you monitor services in production?" });
    expect(result).toMatchObject({ fixedAction: "DEEPEN", adaptedFixedQuestion: "How did you monitor service health before customer impact?", fixedEvidenceAnchor: "Grafana alerts" });
  });

  it("skips a specific second non-job question only when literal evidence contains its competency and a third question exists", async () => {
    const snapshot = "We monitored service health with Grafana alerts before customer impact.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null, secondFixedAction: "SKIP", adaptedSecondFixedQuestion: null, secondFixedEvidenceAnchor: "monitored service health" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, snapshot, secondFixedQuestion: "How did you monitor service health?", secondFixedType: "bank", hasThirdFixedQuestion: true });
    expect(result).toMatchObject({ secondFixedAction: "SKIP", secondFixedEvidenceAnchor: "monitored service health" });
  });

  it("keeps a future topic mentioned spontaneously without evidence for its competency", async () => {
    const snapshot = "We discussed Kubernetes as a future migration idea, but we did not deploy or operate it.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null, secondFixedAction: "SKIP", adaptedSecondFixedQuestion: null, secondFixedEvidenceAnchor: "Kubernetes as a future migration idea" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, snapshot, secondFixedQuestion: "How did you deploy Kubernetes workloads?", secondFixedType: "resume" });
    expect(result).toMatchObject({ secondFixedAction: "KEEP", secondFixedEvidenceAnchor: null });
  });

  it("evaluates a broad second project question separately from a specific question about that project", async () => {
    const snapshot = "I built a Kafka payment pipeline for customers, designed retries, monitored production alerts, and reduced processing latency by forty percent after launch with three teammates across two services.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null, secondFixedAction: "KEEP", adaptedSecondFixedQuestion: null, secondFixedEvidenceAnchor: null });
    const service = new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher);
    await expect(service.analyze({ ...input, snapshot, secondFixedQuestion: "Tell me about a project you worked on?", secondFixedType: "resume" })).resolves.toMatchObject({ secondFixedAction: "SKIP" });
    await expect(service.analyze({ ...input, snapshot, secondFixedQuestion: "What trade-off did you make in the Kafka pipeline?", secondFixedType: "resume" })).resolves.toMatchObject({ secondFixedAction: "KEEP" });
  });

  it("deepens the second question while preserving its competency", async () => {
    const snapshot = "I implemented Grafana alerts and reduced customer-facing incidents.";
    const fetcher = response({ revision: 2, followUpAction: "NONE", followUpQuestion: null, followUpAnchor: null, fixedAction: "KEEP", adaptedFixedQuestion: null, fixedEvidenceAnchor: null, secondFixedAction: "DEEPEN", adaptedSecondFixedQuestion: "How did Grafana alerts monitor production services?", secondFixedEvidenceAnchor: "Grafana alerts" });
    const result = await new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze({ ...input, snapshot, secondFixedQuestion: "How did you use alerts to monitor production services?", secondFixedType: "job" });
    expect(result).toMatchObject({ secondFixedAction: "DEEPEN", adaptedSecondFixedQuestion: "How did Grafana alerts monitor production services?", secondFixedEvidenceAnchor: "Grafana alerts" });
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
      secondFixedAction: "KEEP",
      adaptedSecondFixedQuestion: null,
      secondFixedEvidenceAnchor: null,
    });
  });

  it.each([
    ["malformed JSON", "{bad" , "invalid_json"],
    ["wrong shape", JSON.stringify({ revision: 2 }), "invalid_shape"],
  ])("reports %s with content-free diagnostics", async (_label, content, expectedReason) => {
    const fetcher = rawResponse(content);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze(input)).resolves.toBeNull();
      expect(String(info.mock.calls[0]?.[0])).toContain(`\"reason\":\"${expectedReason}\"`);
      expect(String(info.mock.calls[0]?.[0])).not.toContain(input.snapshot);
    } finally { info.mockRestore(); }
  });

  it("reports an invalid response body as invalid_json", async () => {
    const fetcher = vi.fn(async () => new Response("{bad", { status: 200 }));
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, fetcher).analyze(input)).resolves.toBeNull();
      expect(String(info.mock.calls[0]?.[0])).toContain('"reason":"invalid_json"');
      expect(String(info.mock.calls[0]?.[0])).not.toContain(input.snapshot);
    } finally { info.mockRestore(); }
  });

  it("reports provider status and timeout separately", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const unavailable = vi.fn(async () => new Response("", { status: 503 }));
      await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 500 }, unavailable).analyze(input)).resolves.toBeNull();
      expect(String(info.mock.calls.at(-1)?.[0])).toContain("provider_status");
      const slow = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })));
      await expect(new SpeculativeTurnAnalysisService({ apiKey: "key", model: "model", timeoutMs: 5 }, slow).analyze(input)).resolves.toBeNull();
      expect(String(info.mock.calls.at(-1)?.[0])).toContain("timeout");
    } finally { info.mockRestore(); }
  });
});
