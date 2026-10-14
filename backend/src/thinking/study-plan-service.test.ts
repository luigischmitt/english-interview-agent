import { describe, expect, it, vi } from "vitest";
import { parseStudyPlanInput, OpenRouterStudyPlanService, studyRuleCatalog, type StudyPlanInput } from "./study-plan-service.js";
import { ThinkingServiceError } from "./errors.js";
import type { ThinkingConfig } from "./config.js";

const config: ThinkingConfig = { openRouterApiKey: "test-key", model: "test-model", timeoutMs: 1_000, orchestrationTimeoutMs: 1_000, diagnosticsEnabled: false };
const input: StudyPlanInput = {
  roleContext: { targetRole: "Backend Engineer", seniority: "senior" },
  patterns: [{ type: "GRAMMAR", evidence: "Yesterday we deploy the service.", rephrasedExample: "Yesterday we deployed the service." }],
  technicalGaps: [{ evidence: "the queue was slower", explanation: "The answer did not explain the recovery trade-off." }],
};
const target = {
  lessonKey: "verb-tenses", ruleId: "verb-tenses.past", explanation: "Use o passado para uma ação concluída.", why: "A resposta fala de uma implantação concluída ontem.",
  sourceEvidence: input.patterns[0].evidence, correctedTarget: input.patterns[0].rephrasedExample, acceptedAnswers: [input.patterns[0].rephrasedExample],
};
function providerResponse(value: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
}

describe("study plan service", () => {
  it("matches the complete versioned 49-part lesson catalog", () => {
    const studyRuleCatalogV1 = {
      prepositions: ["prepositions.at", "prepositions.on", "prepositions.in", "prepositions.for", "prepositions.to", "prepositions.combos", "prepositions.by"],
      articles: ["articles.a-an", "articles.the", "articles.none", "articles.the-fixed"],
      "verb-tenses": ["verb-tenses.past", "verb-tenses.perfect", "verb-tenses.experience", "verb-tenses.past-cont", "verb-tenses.present", "verb-tenses.future"],
      "verb-forms": ["verb-forms.to", "verb-forms.ing", "verb-forms.base", "verb-forms.s", "verb-forms.irregular", "verb-forms.participle", "verb-forms.used-to"],
      "word-choice": ["word-choice.actually", "word-choice.pretend", "word-choice.realize", "word-choice.eventually", "word-choice.do-make", "word-choice.attend", "word-choice.say-tell"],
      "sentence-structure": ["sentence-structure.subject", "sentence-structure.order", "sentence-structure.questions", "sentence-structure.negation", "sentence-structure.short", "sentence-structure.connectors"],
      "plural-agreement": ["plural-agreement.plural", "plural-agreement.special", "plural-agreement.verb", "plural-agreement.uncountable", "plural-agreement.quantity", "plural-agreement.compound"],
      other: ["other.clarify", "other.time", "other.structure", "other.gap", "other.close", "other.natural"],
    };
    expect(studyRuleCatalog).toEqual(studyRuleCatalogV1);
    expect(Object.values(studyRuleCatalog).flat()).toHaveLength(49);
  });

  it("accepts only bounded report findings without preclassified lesson ids", () => {
    expect(parseStudyPlanInput(input)).toEqual(input);
    expect(parseStudyPlanInput({ ...input, transcript: "raw transcript" })).toBeNull();
    expect(parseStudyPlanInput({ ...input, patterns: [{ ...input.patterns[0], ruleId: "made-up.rule" }] })).toBeNull();
    expect(parseStudyPlanInput({ ...input, patterns: [{ ...input.patterns[0], rephrasedExample: "x".repeat(241) }] })).toBeNull();
    expect(parseStudyPlanInput({ ...input, technicalGaps: [{ evidence: "x".repeat(121), explanation: "gap" }] })).toBeNull();
  });

  it("returns an empty plan without making a provider call when there are no patterns", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new OpenRouterStudyPlanService(config, fetcher);
    await expect(service.create({ ...input, patterns: [] })).resolves.toEqual({ targets: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a grounded validated plan from one structured provider call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(providerResponse({ targets: [target] }));
    const service = new OpenRouterStudyPlanService(config, fetcher);
    await expect(service.create(input)).resolves.toEqual({ targets: [{ ...target, category: "ENGLISH_COMMUNICATION", acceptedAnswers: [target.correctedTarget] }] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetcher.mock.calls[0][1]?.body)) as { max_tokens: number; messages: Array<{ content: string }> };
    expect(request.max_tokens).toBeLessThanOrEqual(900);
    expect(request.messages[1].content).not.toContain("resume");
  });

  it("rejects unknown catalog ids, duplicate targets and ungrounded evidence", async () => {
    for (const targets of [
      [{ ...target, ruleId: "made-up.rule" }],
      [{ ...target, lessonKey: "word-choice", ruleId: "word-choice.pretend" }],
      [target, target],
      [{ ...target, sourceEvidence: "I said something else." }],
      [{ ...target, correctedTarget: "Yesterday we deploy the service." }],
      [{ ...target, acceptedAnswers: ["não entendi"] }],
    ]) {
      const service = new OpenRouterStudyPlanService(config, async () => providerResponse({ targets }));
      await expect(service.create(input)).rejects.toMatchObject({ code: "THINKING_INVALID_PROVIDER_RESPONSE", status: 502 });
    }
  });

  it("returns a generic thinking error when the provider fails and does not retry", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider detail", { status: 503 }));
    const service = new OpenRouterStudyPlanService(config, fetcher);
    const result = service.create(input);
    await expect(result).rejects.toBeInstanceOf(ThinkingServiceError);
    await expect(result).rejects.toMatchObject({ message: "The reasoning service is unavailable." });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
