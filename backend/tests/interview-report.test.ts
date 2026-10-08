import { expectConciseTechnicalRules, expectRealReportCalibrationRules, expectSpecificPriorityRules, expectPrecisionRules } from "./report-prompt-assertions.js";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { OpenRouterInterviewReportService } from "../src/thinking/openrouter-interview-report-service.js";
import { defaultThinkingModel, loadThinkingConfig } from "../src/thinking/config.js";
import { createInterviewReportService } from "../src/thinking/openrouter-interview-report-service.js";
import { OpenRouterOrchestrationService } from "../src/thinking/openrouter-orchestration-service.js";
import type { InterviewReport, InterviewReportInput } from "../src/thinking/types.js";
import type { SpeechConfig } from "../src/speech/config.js";

const speechConfig: SpeechConfig = {
  provider: "fake", kokoroBaseUrl: "http://localhost:8888", kokoroTimeoutMs: 1000,
  interviewerVoice: "af_bella+af_heart", defaultSpeed: 1, format: "mp3",
};
const input: InterviewReportInput = {
  roleContext: { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" },
  turns: [
    { sequenceNumber: 2, question: "How would you improve reliability?", answer: "I would add timeouts and bounded retries." },
    { sequenceNumber: 4, question: "How do you monitor it?", answer: "We monitor errors and latency." },
  ],
};
const jobDirection = { targetRole: "Backend Engineer", suggestedSeniority: "mid-level" as const, mainInterviewEmphasis: "Reliability in production.", priorityCompetencies: ["resilience", "observability"], productTeamContext: "A small platform team supporting customer-facing services." };
const cleanEvidenceCounts = { mismatch: 0, invalidFormat: 0, artifact: 0, duplicate: 0, limit: 0 };

const validReport: InterviewReport = {
  evidenceReview: {
    technicalStrengths: { candidates: 1, accepted: 1, rejected: 0, rejectionReasons: cleanEvidenceCounts },
    technicalGaps: { candidates: 1, accepted: 1, rejected: 0, rejectionReasons: cleanEvidenceCounts },
    englishPatterns: { candidates: 1, accepted: 1, rejected: 0, rejectionReasons: cleanEvidenceCounts },
    priorities: { candidates: 1, accepted: 1, rejected: 0, rejectionReasons: cleanEvidenceCounts },
  },
  technicalContent: {
    summary: "Covers bounded retries and basic monitoring.",
    strengths: [{ sequenceNumber: 2, evidence: "bounded retries", explanation: "Nomeia uma proteção para tentativas repetidas." }],
    gaps: [{ sequenceNumber: 4, evidence: "monitor errors", explanation: "A resposta não explica limites ou alertas." }],
  },
  englishCommunication: {
    clarity: "MOSTLY_CLEAR", evidenceStatus: "LIMITED",
    patterns: [{ type: "GRAMMAR", sequenceNumber: 4, evidence: "We monitor errors", suggestion: "Use o presente simples de forma consistente.", rephrasedExample: "We monitor errors and latency." }],
  },
  priorities: [{ area: "TECHNICAL_CONTENT", sequenceNumber: 4, evidence: "errors and latency", focus: "Limites de alerta", exercise: "Explique em um minuto quais limites acionariam um alerta." }],
};
const providerReport = {
  technicalContent: validReport.technicalContent,
  englishCommunication: { clarity: validReport.englishCommunication.clarity, patterns: validReport.englishCommunication.patterns },
  priorities: validReport.priorities,
};

function providerResponse(content: string, status = 200, usage?: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], ...(usage ? { usage } : {}) }), { status });
}

function makeService(fetchImplementation: typeof fetch) {
  return new OpenRouterInterviewReportService({ key: "test-key", model: defaultThinkingModel, timeoutMs: 1234, fetchImplementation });
}

describe("final interview report service", () => {
  it("makes one structured, privacy-routed batch request and returns model/version metadata", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let requestBody: unknown;
    const service = makeService(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return providerResponse(JSON.stringify(providerReport), 200, { prompt_tokens: 800, completion_tokens: 210, cost: 0.00012, prompt_tokens_details: { cached_tokens: 500 } });
    });

    await expect(service.generate(input)).resolves.toEqual({ ...validReport, model: defaultThinkingModel, analysisVersion: "v2" });
    const body = requestBody as { provider: unknown; response_format: { json_schema: { strict: boolean; schema: { properties: Record<string, unknown> } } }; messages: Array<{ content: string }> };
    expect(body.provider).toEqual({ sort: "latency", require_parameters: true, data_collection: "deny" });
    expect((body as { usage?: unknown }).usage).toEqual({ include: true });
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties).not.toHaveProperty("score");
    expect(body.response_format.json_schema.schema.properties).not.toHaveProperty("internal_rationale");
    expect(body.messages[0].content).toContain("Write the report in Brazilian Portuguese");
    expect(body.messages[0].content).toContain("Cite the matching sequenceNumber and a short exact excerpt from that answer");
    expect(body.messages[0].content).toContain("Review each question and its answer as a separate pair");
    expect(body.messages[0].content).toContain("Do not infer mastery, correctness, ownership, impact, or expertise from merely naming a tool");
    expect(body.messages[0].content).toContain("Do not criticize isolated acronyms, names, technical terms, fillers, repeated syllables, phonetic fragments");
    expect(body.messages[0].content).toContain("Include a concrete, corrected English rephrasing grounded in that answer");
    expect(body.messages[0].content).toContain("audit every answer independently");
    expect(body.messages[0].content).toContain("articles; prepositions and verb/adjective collocations");
    expect(body.messages[0].content).toContain("tense choice against explicit time markers");
    expect(body.messages[0].content).toContain("subject-verb agreement; countability and plural; word order; literal translations; and false cognates");
    expectPrecisionRules(body.messages[0].content);
    expect(body.messages[0].content).toContain("Group occurrences by underlying pattern (one item per pattern, not per occurrence)");
    expect(body.messages[0].content).toContain("Never turn an English grammar, vocabulary, or phrasing error into a technical gap");
    expectConciseTechnicalRules(body.messages[0].content);
    expectRealReportCalibrationRules(body.messages[0].content);
    expectSpecificPriorityRules(body.messages[0].content);
    expect(body.messages[0].content).toContain("If a concrete action or decision addresses the topic, do not claim in the summary that the topic was unanswered");
    expect(body.messages[0].content).toContain("MUST be written in Brazilian Portuguese");
    expect(body.messages[0].content).toContain("The suggestion MUST be written in Brazilian Portuguese; put any corrected English only in rephrasedExample");
    const schema = body.response_format.json_schema.schema.properties;
    const englishPatternSchema = schema.englishCommunication as { properties: { patterns: { maxItems: number; items: { properties: { suggestion: { description: string }; rephrasedExample: { description: string } } } } } };
    expect(englishPatternSchema.properties.patterns.maxItems).toBe(4);
    expect(englishPatternSchema.properties.patterns.items.properties.suggestion.description).toContain("MUST be written in Brazilian Portuguese");
    expect(englishPatternSchema.properties.patterns.items.properties.rephrasedExample.description).toContain("complete English sentence");
    expect((schema.technicalContent as { properties: { strengths: { maxItems: number }; gaps: { maxItems: number } } }).properties.strengths.maxItems).toBe(2);
    expect((schema.technicalContent as { properties: { strengths: { maxItems: number }; gaps: { maxItems: number } } }).properties.gaps.maxItems).toBe(3);
    expect(JSON.parse(body.messages[1].content)).toEqual({ roleContext: input.roleContext, turns: input.turns });
    const providerLog = info.mock.calls.map((call) => JSON.parse(String(call[0]))).find((entry) => entry.phase === "provider");
    expect(providerLog).toMatchObject({ event: "interview_report_phase_timing", promptTokens: 800, completionTokens: 210, costUsd: 0.00012, cachedTokens: 500 });
    expect(JSON.stringify(providerLog)).not.toContain(input.turns[0]?.answer);
  });

  it("generates report prose and a matching schema in the requested English locale", async () => {
    let requestBody: unknown;
    const englishReport = {
      technicalContent: { summary: "You described bounded retries and basic monitoring.", strengths: [], gaps: [] },
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns: [] },
      priorities: [],
    };
    const service = makeService(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return providerResponse(JSON.stringify(englishReport));
    });

    const report = await service.generate({ ...input, locale: "en" });
    expect(report).toMatchObject({ locale: "en", technicalContent: englishReport.technicalContent });
    const body = requestBody as { response_format: { json_schema: { schema: { properties: Record<string, unknown> } } }; messages: Array<{ content: string }> };
    expect(body.messages[0].content).toContain("All user-facing report prose must be in clear English");
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ locale: "en" });
    const schema = body.response_format.json_schema.schema.properties;
    const englishPatternSchema = schema.englishCommunication as { properties: { patterns: { items: { properties: { suggestion: { description: string } } } } } };
    expect(englishPatternSchema.properties.patterns.items.properties.suggestion.description).toContain("MUST be written in clear English");
  });

  it("lets a technical priority repeat any competency linked by a validated finding of the same answer", async () => {
    const strength = { sequenceNumber: 2, evidence: "bounded retries", explanation: "Você conecta retries limitados à resiliência do serviço.", vacancyCompetency: "resilience" };
    const gap = { sequenceNumber: 2, evidence: "timeouts", explanation: "Você não explicou como mediria se os timeouts funcionam em produção.", vacancyCompetency: "observability" };
    const priority = { area: "TECHNICAL_CONTENT", sequenceNumber: 2, evidence: "timeouts", focus: "Observabilidade dos timeouts", exercise: "Explique em voz alta quais métricas mostrariam se os timeouts estão funcionando em produção.", vacancyCompetency: "observability" };
    const content = {
      technicalContent: { summary: "Relaciona retries limitados à resiliência do serviço.", strengths: [strength], gaps: [gap] },
      englishCommunication: { clarity: "CLEAR", patterns: [] },
      priorities: [priority, { ...priority, focus: "Outro foco técnico", vacancyCompetency: "security" }],
    };
    const report = await makeService(async () => providerResponse(JSON.stringify(content))).generate({ ...input, jobDirection });
    expect(report.technicalContent.gaps).toEqual([gap]);
    expect(report.priorities[0]).toEqual(priority);
    const { vacancyCompetency: _unlinked, ...secondPriority } = { ...priority, focus: "Outro foco técnico", vacancyCompetency: "security" };
    expect(report.priorities[1]).toEqual(secondPriority);
  });

  it("sends only the approved direction snapshot and accepts only exact vacancy competency labels", async () => {
    const linkedStrength = { sequenceNumber: 2, evidence: "bounded retries", explanation: "Você conecta retries limitados à resiliência do serviço.", vacancyCompetency: "resilience" };
    let sent: Record<string, unknown> | undefined;
    const content = {
      technicalContent: { summary: "Relaciona retries limitados à resiliência do serviço.", strengths: [linkedStrength], gaps: [] },
      englishCommunication: { clarity: "CLEAR", patterns: [] },
      priorities: [],
    };
    const report = await makeService(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      sent = JSON.parse(body.messages[1].content);
      return providerResponse(JSON.stringify(content));
    }).generate({ ...input, jobDirection });
    expect(sent).toEqual({ roleContext: input.roleContext, jobDirection, turns: input.turns });
    expect(report.jobDirection).toEqual(jobDirection);
    expect(report.technicalContent.strengths).toEqual([linkedStrength]);

    const invented = { ...content, technicalContent: { ...content.technicalContent, strengths: [{ ...linkedStrength, vacancyCompetency: "distributed consensus" }] } };
    const { vacancyCompetency: _droppedLabel, ...unlinkedStrength } = linkedStrength;
    const withoutDirection = await makeService(async () => providerResponse(JSON.stringify(invented))).generate(input);
    expect(withoutDirection.technicalContent.strengths).toEqual([unlinkedStrength]);
    expect(withoutDirection.jobDirection).toBeUndefined();
    const inventedWithDirection = await makeService(async () => providerResponse(JSON.stringify(invented))).generate({ ...input, jobDirection });
    expect(inventedWithDirection.technicalContent.strengths).toEqual([unlinkedStrength]);
    const directionWithWrongSeniority = await makeService(async () => providerResponse(JSON.stringify(content))).generate({ ...input, jobDirection: { ...jobDirection, suggestedSeniority: "senior" } });
    expect(directionWithWrongSeniority.technicalContent.strengths).toEqual([unlinkedStrength]);
    expect(directionWithWrongSeniority.jobDirection).toBeUndefined();
  });

  it("logs only aggregate phase timings for provider and validation work", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      await makeService(async () => providerResponse(JSON.stringify(providerReport))).generate(input);

      const timingEvents = info.mock.calls.flatMap(([entry]) => {
        if (typeof entry !== "string") return [];
        const event = JSON.parse(entry) as Record<string, unknown>;
        return event.event === "interview_report_phase_timing" ? [event] : [];
      });
      expect(timingEvents).toHaveLength(2);
      expect(timingEvents.map(({ phase }) => phase)).toEqual(["provider", "validation"]);
      for (const event of timingEvents) {
        expect(Object.keys(event).sort()).toEqual(event.phase === "provider"
          ? ["cachedTokens", "completionTokens", "costUsd", "durationMs", "event", "outcome", "phase", "promptTokens", "turnCount"]
          : ["durationMs", "event", "phase", "turnCount"]);
        expect(event.durationMs).toEqual(expect.any(Number));
        expect(event.turnCount).toBe(input.turns.length);
        expect(JSON.stringify(event)).not.toContain("bounded retries");
      }
    } finally {
      info.mockRestore();
    }
  });

  it("sends all eight completed answers in one report request with enough output budget", async () => {
    const turns = Array.from({ length: 8 }, (_, index) => ({
      sequenceNumber: (index + 1) * 2,
      question: `Question ${index + 1}?`,
      answer: index === 1 ? "We monitor errors and latency." : `Answer ${index + 1} describes the implementation clearly.`,
    }));
    let requestBody: { max_tokens: number; messages: Array<{ content: string }> } | undefined;
    const report = await makeService(async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return providerResponse(JSON.stringify(providerReport));
    }).generate({ ...input, turns });

    expect(report.analysisVersion).toBe("v2");
    expect(requestBody?.max_tokens).toBeGreaterThanOrEqual(4_096);
    expect(JSON.parse(requestBody?.messages[1].content ?? "{}").turns).toEqual(turns);
  });

  it("salvages valid report content when an optional evidence item is fabricated", async () => {
    const partiallyInvalid = {
      ...providerReport,
      technicalContent: {
        ...validReport.technicalContent,
        strengths: [...validReport.technicalContent.strengths, { sequenceNumber: 4, evidence: "not in this answer", explanation: "Claim without support." }],
      },
      englishCommunication: {
        ...providerReport.englishCommunication,
        patterns: [...providerReport.englishCommunication.patterns, { ...providerReport.englishCommunication.patterns[0], evidence: "fabricated" }],
      },
    };
    const report = await makeService(async () => providerResponse(JSON.stringify(partiallyInvalid))).generate(input);
    expect(report.technicalContent.strengths).toEqual(validReport.technicalContent.strengths);
    expect(report.englishCommunication.patterns).toEqual(validReport.englishCommunication.patterns);
    expect(report.analysisVersion).toBe("v2");
  });

  it("keeps complete feedback and drops truncated optional prose while recovering a truncated summary", async () => {
    const truncated = {
      ...providerReport,
      technicalContent: {
        ...providerReport.technicalContent,
        summary: "O",
        strengths: [
          { ...providerReport.technicalContent.strengths[0], explanation: "Nomeia uma proteção para solu" },
          { sequenceNumber: 2, evidence: "timeouts", explanation: "A resposta identifica timeouts como proteção." },
        ],
      },
      englishCommunication: {
        ...providerReport.englishCommunication,
        patterns: [{ ...providerReport.englishCommunication.patterns[0], suggestion: "Use o presente simples de forma porque" }],
      },
      priorities: [{ ...providerReport.priorities[0], exercise: "Explique em um minuto quais limites acionariam a documenta" }],
    };
    const report = await makeService(async () => providerResponse(JSON.stringify(truncated))).generate(input);

    expect(report.technicalContent.summary).toBe("As respostas foram analisadas quanto ao conteúdo técnico apresentado.");
    expect(report.technicalContent.strengths).toEqual([{ sequenceNumber: 2, evidence: "timeouts", explanation: "A resposta identifica timeouts como proteção." }]);
    expect(report.englishCommunication.patterns).toEqual([]);
    expect(report.priorities).toEqual([]);
    expect(report.englishCommunication.evidenceStatus).toBe("CANDIDATES_REJECTED");
  });

  it("preserves complete user-facing sentences", async () => {
    const report = await makeService(async () => providerResponse(JSON.stringify(providerReport))).generate(input);

    expect(report).toMatchObject(validReport);
    expect(report.technicalContent.summary).toBe(validReport.technicalContent.summary);
    expect(report.technicalContent.strengths).toEqual(validReport.technicalContent.strengths);
  });

  it("keeps only the three most impactful distinct English findings", async () => {
    const answer = "I build reliable services. I design clear APIs. I deploy tested changes. I explain technical choices. I review code carefully. I monitor service health. I document useful decisions. I support production systems.";
    const turns = [{ sequenceNumber: 1, question: "Tell me about your work.", answer }];
    const evidence = [
      "I build reliable services", "I design clear APIs", "I deploy tested changes", "I explain technical choices",
      "I review code carefully", "I monitor service health", "I document useful decisions", "I support production systems",
    ];
    const patterns = evidence.map((excerpt, index) => ({
      type: "GRAMMAR",
      sequenceNumber: 1,
      evidence: excerpt,
      suggestion: `Sugestão distinta ${index + 1} para esta resposta.`,
      rephrasedExample: `${excerpt} today.`,
    }));
    const report = await makeService(async () => providerResponse(JSON.stringify({
      ...providerReport,
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns },
    }))).generate({ ...input, turns });

    expect(report.englishCommunication.patterns).toHaveLength(3);
    expect(report.englishCommunication.patterns.map((pattern) => pattern.evidence)).toEqual(evidence.slice(0, 3));
  });

  it("counts valid items beyond category limits without breaking evidence totals", async () => {
    const evidence = [
      "I build APIs", "I write tests", "I deploy services", "I review code", "I track errors",
      "I use metrics", "I manage queues", "I tune queries", "I add caching", "I document decisions",
    ];
    const turns = [{ sequenceNumber: 1, question: "What do you do?", answer: `${evidence.map((item) => `${item}.`).join(" ")} We monitor the service.` }];
    const technical = (items: string[]) => items.map((item) => ({ sequenceNumber: 1, evidence: item, explanation: "A resposta apresenta uma ação técnica concreta." }));
    const patterns = evidence.map((item) => ({
      type: "GRAMMAR", sequenceNumber: 1, evidence: item,
      suggestion: "Mantenha esta frase no presente simples para descrever o trabalho.",
      rephrasedExample: `${item.replace("I ", "I also ")}.`,
    }));
    const priorities = evidence.slice(0, 4).map((item, index) => ({
      area: "TECHNICAL_CONTENT", sequenceNumber: 1, evidence: item, focus: `Ação ${index + 1}`,
      exercise: "Descreva esta ação e explique seu objetivo em uma frase.",
    }));
    const providerOutput = {
      ...providerReport,
      technicalContent: {
        summary: "A resposta relata várias atividades técnicas.",
        strengths: technical(evidence.slice(0, 9)),
        gaps: technical(evidence.slice(1, 10)),
      },
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns },
      priorities,
    };
    const report = await makeService(async () => providerResponse(JSON.stringify(providerOutput))).generate({ ...input, turns });
    const counts = report.evidenceReview;

    expect(report.technicalContent.strengths).toHaveLength(2);
    expect(report.technicalContent.gaps).toHaveLength(3);
    expect(report.englishCommunication.patterns).toHaveLength(3);
    expect(report.priorities).toHaveLength(3);
    expect(counts?.technicalStrengths).toMatchObject({ candidates: 9, accepted: 2, rejected: 7, rejectionReasons: { limit: 7 } });
    expect(counts?.technicalGaps).toMatchObject({ candidates: 9, accepted: 3, rejected: 6, rejectionReasons: { limit: 6 } });
    expect(counts?.englishPatterns).toMatchObject({ candidates: 10, accepted: 3, rejected: 7, rejectionReasons: { limit: 7 } });
    expect(counts?.priorities).toMatchObject({ candidates: 4, accepted: 3, rejected: 1, rejectionReasons: { limit: 1 } });
    for (const category of Object.values(counts ?? {})) {
      if (typeof category !== "object" || !category || !("rejected" in category)) continue;
      expect(Object.values(category.rejectionReasons ?? {}).reduce((sum, count) => sum + count, 0)).toBe(category.rejected);
    }
  });

  it("preserves valid short English evidence", async () => {
    const answer = "This request depends of the cache. I use AWS.";
    const turns = [{ sequenceNumber: 1, question: "How does the service work?", answer }];
    const patterns = [
      { type: "WORD_CHOICE", sequenceNumber: 1, evidence: "depends of", suggestion: "Use a preposição adequada para introduzir aquilo de que algo depende.", rephrasedExample: "This request depends on the cache." },
      { type: "GRAMMAR", sequenceNumber: 1, evidence: "I use AWS", suggestion: "Revise a frase completa e mantenha o trecho curto como evidência.", rephrasedExample: "I use AWS for this service." },
    ];
    const report = await makeService(async () => providerResponse(JSON.stringify({
      ...providerReport,
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns },
    }))).generate({ ...input, turns });

    expect(report.englishCommunication.patterns.map((pattern) => pattern.evidence)).toEqual(["depends of", "I use AWS"]);
  });

  it("keeps different findings with the same suggestion, while removing duplicates and likely artifacts", async () => {
    const answer = "I build reliable services. I design clear APIs. pfffff. I said TFFF. I heard hahaha. I said...";
    const turns = [{ sequenceNumber: 1, question: "Tell me about your work.", answer }];
    const first = { type: "GRAMMAR", sequenceNumber: 1, evidence: "I build reliable services", suggestion: "Use o presente simples para descrever o trabalho.", rephrasedExample: "I build reliable services every day." };
    const patterns = [
      first,
      { ...first, evidence: " I build reliable services ", suggestion: " Mantenha o tempo presente para explicar o trabalho. " },
      { ...first, evidence: "I design clear APIs", rephrasedExample: "I design clear APIs every day." },
      { ...first, evidence: "pfffff", suggestion: "Não corrija este ruído.", rephrasedExample: "This is not an English sentence." },
      { ...first, evidence: "I said TFFF", suggestion: "Não corrija este fragmento.", rephrasedExample: "This is not an English sentence." },
      { ...first, evidence: "I heard hahaha", suggestion: "Não corrija sílabas repetidas.", rephrasedExample: "This is not an English sentence." },
      { ...first, evidence: "I said...", suggestion: "Não corrija este fragmento incompleto.", rephrasedExample: "This is not an English sentence." },
    ];
    const report = await makeService(async () => providerResponse(JSON.stringify({
      ...providerReport,
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns },
    }))).generate({ ...input, turns });

    expect(report.englishCommunication.patterns).toEqual([first, { ...first, evidence: "I design clear APIs", rephrasedExample: "I design clear APIs every day." }]);
    expect(report.evidenceReview?.englishPatterns.rejectionReasons).toEqual({ mismatch: 0, invalidFormat: 0, artifact: 4, duplicate: 1, limit: 0 });
  });

  it("does not merge distinct English errors just because their suggestions match", async () => {
    const answer = "I added index to the table. I have presented it last month.";
    const turns = [{ sequenceNumber: 3, question: "What did you change?", answer }];
    const patterns = [
      { type: "GRAMMAR", sequenceNumber: 3, evidence: "added index", suggestion: "Revise pontos gramaticais que afetam a clareza.", rephrasedExample: "I added an index to the table." },
      { type: "GRAMMAR", sequenceNumber: 3, evidence: "have presented it last month", suggestion: "Revise pontos gramaticais que afetam a clareza.", rephrasedExample: "I presented it last month." },
    ];
    const report = await makeService(async () => providerResponse(JSON.stringify({
      ...providerReport,
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns },
    }))).generate({ ...input, turns });

    expect(report.englishCommunication.patterns).toEqual(patterns);
    expect(report.evidenceReview?.englishPatterns).toMatchObject({ candidates: 2, accepted: 2, rejected: 0 });
  });

  it("adds missing punctuation to complete feedback sentences but rejects fragments and truncations", async () => {
    const answer = "I added index to table. I presented it last month. We changed the migration.";
    const turns = [{ sequenceNumber: 1, question: "What did you change?", answer }];
    const patterns = [
      { type: "GRAMMAR", sequenceNumber: 1, evidence: "added index", suggestion: "Use an article before a singular countable noun", rephrasedExample: "I added an index to the table" },
      { type: "GRAMMAR", sequenceNumber: 1, evidence: "presented it last month", suggestion: "Use past tense consistently", rephrasedExample: "Because we presented it last month" },
      { type: "GRAMMAR", sequenceNumber: 1, evidence: "changed the migration", suggestion: "Use a complete explanation for this correction because", rephrasedExample: "We staged a migration in two steps" },
      { type: "GRAMMAR", sequenceNumber: 1, evidence: "added index", suggestion: "Use the article a", rephrasedExample: "I added an index to the table..." },
    ];
    const report = await makeService(async () => providerResponse(JSON.stringify({
      ...providerReport,
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns },
    }))).generate({ ...input, turns });

    expect(report.englishCommunication.patterns).toEqual([{
      ...patterns[0],
      suggestion: "Use an article before a singular countable noun.",
      rephrasedExample: "I added an index to the table.",
    }]);
    expect(report.evidenceReview?.englishPatterns).toMatchObject({ candidates: 4, accepted: 1, rejected: 3, rejectionReasons: { invalidFormat: 3 } });
  });

  it("preserves already punctuated sentences within the schema limit before applying fragment heuristics", async () => {
    const answer = "The service was slow. We added an index.";
    const turns = [{ sequenceNumber: 1, question: "What changed?", answer }];
    const longCompleteSuggestion = "Revise esta construção para manter clareza, precisão e relevância profissional, usando exemplos específicos diretamente relacionados à pergunta do entrevistador e ao contexto da resposta.";
    expect(longCompleteSuggestion.length).toBeGreaterThan(184);
    expect(longCompleteSuggestion.length).toBeLessThanOrEqual(200);
    const pattern = {
      type: "GRAMMAR", sequenceNumber: 1, evidence: "The service was slow",
      suggestion: longCompleteSuggestion,
      rephrasedExample: "Because the service was slow, we added an index.",
    };
    const invalidFragments = [
      { ...pattern, suggestion: "Because." },
      { ...pattern, evidence: "The service was slow", rephrasedExample: "Because we presented it last month." },
    ];
    const report = await makeService(async () => providerResponse(JSON.stringify({
      ...providerReport,
      englishCommunication: { clarity: "MOSTLY_CLEAR", patterns: [pattern, ...invalidFragments] },
    }))).generate({ ...input, turns });

    expect(report.englishCommunication.patterns).toEqual([pattern]);
    expect(report.evidenceReview?.englishPatterns).toMatchObject({ candidates: 3, accepted: 1, rejected: 2 });
  });

  it("does not allow technical observations to cite evidence from a different answer", async () => {
    const mismatched = {
      ...providerReport,
      technicalContent: {
        ...providerReport.technicalContent,
        strengths: [
          { sequenceNumber: 2, evidence: "bounded retries", explanation: "Cita tentativas com limite explícito." },
          { sequenceNumber: 4, evidence: "bounded retries", explanation: "Atribui a outra resposta uma informação que não contém." },
        ],
      },
    };
    const report = await makeService(async () => providerResponse(JSON.stringify(mismatched))).generate(input);

    expect(report.technicalContent.strengths).toEqual([mismatched.technicalContent.strengths[0]]);
  });

  it("rejects unsupported top-level fields", async () => {
    await expect(makeService(async () => providerResponse(JSON.stringify({ ...providerReport, score: 94 }))).generate(input))
      .rejects.toMatchObject({ code: "THINKING_INVALID_PROVIDER_RESPONSE", status: 502 });
  });

  it("maps rate limits, timeouts, and provider failures to standard errors", async () => {
    await expect(makeService(async () => new Response("limit", { status: 429 })).generate(input)).rejects.toMatchObject({ code: "THINKING_RATE_LIMITED", status: 503 });
    await expect(makeService(async () => { throw new DOMException("timeout", "TimeoutError"); }).generate(input)).rejects.toMatchObject({ code: "THINKING_TIMEOUT", status: 504 });
    await expect(makeService(async () => new Response("failed", { status: 503 })).generate(input)).rejects.toMatchObject({ code: "THINKING_PROVIDER_UNAVAILABLE", status: 502 });
  });
});

describe("POST /api/v1/thinking/report", () => {
  it("returns only the batched report and rejects interview identifiers or unordered payloads before provider calls", async () => {
    const reportService = { generate: vi.fn(async () => ({ ...validReport, model: defaultThinkingModel, analysisVersion: "v2" as const })), analyzeTurn: vi.fn(), consolidate: vi.fn() };
    const app = createApp({ speechConfig, reportService });
    const success = await request(app).post("/api/v1/thinking/report").send(input);
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ ...validReport, model: defaultThinkingModel, analysisVersion: "v2" });
    expect(reportService.generate).toHaveBeenCalledWith(input);

    const withInterviewId = await request(app).post("/api/v1/thinking/report").send({ ...input, interviewId: "private-db-id" });
    expect(withInterviewId.status).toBe(400);
    const unordered = await request(app).post("/api/v1/thinking/report").send({ ...input, turns: [...input.turns].reverse() });
    expect(unordered.status).toBe(400);
    const invalidDirection = await request(app).post("/api/v1/thinking/report").send({ ...input, jobDirection: { ...jobDirection, priorityCompetencies: ["x".repeat(101)] } });
    expect(invalidDirection.status).toBe(400);
    expect(reportService.generate).toHaveBeenCalledTimes(1);
  });

  it("rejects excessive answer count and aggregate payload size", async () => {
    const reportService = { generate: vi.fn(), analyzeTurn: vi.fn(), consolidate: vi.fn() };
    const app = createApp({ speechConfig, reportService });
    const tooMany = await request(app).post("/api/v1/thinking/report").send({ ...input, turns: Array.from({ length: 31 }, (_, index) => ({ sequenceNumber: index + 1, question: "Q?", answer: "A." })) });
    expect(tooMany.status).toBe(400);
    const tooLarge = await request(app).post("/api/v1/thinking/report").send({ ...input, turns: Array.from({ length: 7 }, (_, index) => ({ sequenceNumber: index + 1, question: "Q?", answer: String(index).repeat(5_000) })) });
    expect(tooLarge.status).toBe(400);
    expect(reportService.generate).not.toHaveBeenCalled();
  });

  it("does not call the provider when no answers were submitted", async () => {
    const reportService = { generate: vi.fn(), analyzeTurn: vi.fn(), consolidate: vi.fn() };
    const app = createApp({ speechConfig, reportService });
    const response = await request(app).post("/api/v1/thinking/report").send({ ...input, turns: [] });
    expect(response.status).toBe(400);
    expect(reportService.generate).not.toHaveBeenCalled();
  });

  it("returns a standardized configuration fallback", async () => {
    const app = createApp({ speechConfig, reportService: null });
    const response = await request(app).post("/api/v1/thinking/report").send(input);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("THINKING_NOT_CONFIGURED");
  });

  it("sends the report model for reports and the reasoning model for orchestration, and persists the report model", async () => {
    const config = loadThinkingConfig({ OPENROUTER_API_KEY: "k", INTERVIEW_REASONING_MODEL: "vendor/reason", INTERVIEW_REPORT_MODEL: "vendor/report" } as NodeJS.ProcessEnv);
    const models: string[] = [];
    const capture = (content: string): typeof fetch => async (_url, init) => {
      models.push(JSON.parse(String(init?.body)).model);
      return providerResponse(content);
    };

    const reportService = createInterviewReportService(config, capture(JSON.stringify(providerReport)));
    const report = await reportService?.generate(input);
    expect(report?.model).toBe("vendor/report");

    const orchestration = new OpenRouterOrchestrationService(config, capture(JSON.stringify({ decision: "NEXT", followUpQuestion: null, nextQuestion: "Next?", anchor: null, acknowledgement: null })), null);
    await orchestration.decide({
      currentQuestion: "How would you make a REST API reliable?", transcript: "I add bounded retries with jitter and a circuit breaker for the downstream calls.", nextFixedQuestion: "Next?", remainingFixedQuestions: ["Next?"],
      askedQuestions: ["Q?"], followUpUsed: false, roleContext: input.roleContext,
    }).catch(() => undefined);
    expect(models).toEqual(["vendor/report", "vendor/reason"]);
  });
});
