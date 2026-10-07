import { describe, expect, it, vi } from "vitest";
import { OpenRouterJobDirectionService } from "./openrouter-job-direction-service.js";

const tailoredQuestions = [
  "How would you design reliable APIs for the logistics platform?",
  "How would you monitor distributed services in production?",
  "What trade-offs would you consider when scaling this backend?",
  "How would you investigate a production incident in this platform?",
  "How would you keep data consistent across distributed services?",
  "How would you collaborate with product on a technical decision?",
  "How would you test a critical logistics workflow before release?",
  "How would you improve the performance of a slow API endpoint?",
];

const direction = {
  targetRole: "Backend Engineer",
  suggestedSeniority: "senior",
  mainInterviewEmphasis: "Arquitetura de APIs e decisões de confiabilidade.",
  priorityCompetencies: ["Sistemas distribuídos", "Observabilidade"],
  productTeamContext: "Plataforma B2B para logística; equipe de produto e engenharia.",
  suggestedFocus: "technical-depth",
  tailoredQuestions,
};
const input = {
  jobDescription: "We are hiring a backend engineer to build distributed services, improve API reliability, and work with product on a logistics platform. " .repeat(2),
  roleContext: { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" },
};
const providerResponse = (content: unknown, usage?: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }], ...(usage ? { usage } : {}) }), { status: 200 });

describe("OpenRouter job direction service", () => {
  it("requests a strict, non-question direction and returns only validated fields", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let requestBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return providerResponse(direction, { prompt_tokens: 310, completion_tokens: 88, cost: 0.00005, prompt_tokens_details: { cached_tokens: 120 } });
    });
    const service = new OpenRouterJobDirectionService({ key: "test-key", model: "mistral/test", timeoutMs: 1_000, fetchImplementation: fetcher });

    await expect(service.analyze(input)).resolves.toEqual(direction);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(requestBody?.model).toBe("mistral/test");
    expect(requestBody?.provider).toEqual({ require_parameters: true, data_collection: "deny" });
    expect(requestBody?.usage).toEqual({ include: true });
    expect(requestBody?.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true, name: "job_interview_direction" } });
    const messages = requestBody?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("untrusted data");
    expect(messages[0]?.content).toContain("ENGLISH");
    expect(messages[0]?.content).toContain("Never write 'Não informado'");
    expect(messages[0]?.content).toContain("suggestedFocus");
    expect(messages[0]?.content).toContain("The only questions you may write are the tailoredQuestions field");
    expect(messages[1]?.content).toContain(input.jobDescription);
    const jsonSchema = (requestBody?.response_format as { json_schema: { schema: { required: string[]; properties: Record<string, { enum?: string[] }> } } }).json_schema.schema;
    expect(jsonSchema.required).toContain("suggestedFocus");
    expect(jsonSchema.required).toContain("tailoredQuestions");
    expect(jsonSchema.properties.suggestedFocus?.enum).toEqual(["technical-depth", "communication", "behavioral", "mixed"]);
    const log = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(log).toMatchObject({ event: "interview_job_direction_timing", promptTokens: 310, completionTokens: 88, costUsd: 0.00005, cachedTokens: 120 });
    expect(JSON.stringify(log)).not.toContain(input.jobDescription);
  });

  it("normalizes a Portuguese title with seniority and strips placeholder context", async () => {
    const service = new OpenRouterJobDirectionService({
      key: "test-key", model: "mistral/test", timeoutMs: 1_000,
      fetchImplementation: async () => providerResponse({ ...direction, targetRole: "Analista de Dados Sênior", suggestedSeniority: "senior", productTeamContext: "Plataforma de analytics para varejo. Não informado", suggestedFocus: "communication" }),
    });
    await expect(service.analyze(input)).resolves.toMatchObject({ targetRole: "Data Analyst", suggestedSeniority: "senior", productTeamContext: "Plataforma de analytics para varejo.", suggestedFocus: "communication" });
  });

  it("falls back to the setup focus when the provider omits the focus, and rejects titles that are only seniority", async () => {
    const { suggestedFocus: _omitted, ...withoutFocus } = direction;
    const lenient = new OpenRouterJobDirectionService({ key: "k", model: "m", timeoutMs: 1_000, fetchImplementation: async () => providerResponse(withoutFocus) });
    await expect(lenient.analyze(input)).resolves.toMatchObject({ suggestedFocus: "technical-depth" });
    const onlySeniority = new OpenRouterJobDirectionService({ key: "k", model: "m", timeoutMs: 1_000, fetchImplementation: async () => providerResponse({ ...direction, targetRole: "Senior" }) });
    await expect(onlySeniority.analyze(input)).rejects.toMatchObject({ code: "JOB_DIRECTION_INVALID_PROVIDER_RESPONSE" });
  });

  it.each([
    ["extra field", { ...direction, interviewQuestions: ["Tell me about yourself?"] }],
    ["question-shaped content", { ...direction, mainInterviewEmphasis: "What would you build?" }],
    ["too many competencies", { ...direction, priorityCompetencies: Array(6).fill("Skill") }],
    ["invalid focus", { ...direction, suggestedFocus: "everything" }],
    ["invalid seniority", { ...direction, suggestedSeniority: "principal" }],
    ["overlong context", { ...direction, productTeamContext: "x".repeat(281) }],
  ])("rejects malformed provider output (%s)", async (_case, content) => {
    const service = new OpenRouterJobDirectionService({ key: "test-key", model: "mistral/test", timeoutMs: 1_000, fetchImplementation: async () => providerResponse(content) });
    await expect(service.analyze(input)).rejects.toMatchObject({ code: "JOB_DIRECTION_INVALID_PROVIDER_RESPONSE", status: 502 });
  });

  it("maps timeouts and provider failures to safe retryable errors", async () => {
    const timeoutFetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const timeoutService = new OpenRouterJobDirectionService({ key: "test-key", model: "mistral/test", timeoutMs: 5, fetchImplementation: timeoutFetcher });
    await expect(timeoutService.analyze(input)).rejects.toMatchObject({ code: "JOB_DIRECTION_TIMEOUT", status: 504 });

    const unavailableService = new OpenRouterJobDirectionService({ key: "test-key", model: "mistral/test", timeoutMs: 1_000, fetchImplementation: async () => new Response("private provider body", { status: 503 }) });
    await expect(unavailableService.analyze(input)).rejects.toMatchObject({ code: "JOB_DIRECTION_PROVIDER_UNAVAILABLE", status: 502 });
  });

  it("returns a normalized plan only when all eight tailored questions are valid and distinct", async () => {
    const service = new OpenRouterJobDirectionService({
      key: "k", model: "m", timeoutMs: 1_000,
      fetchImplementation: async () => providerResponse({
        ...direction,
        tailoredQuestions: tailoredQuestions.map((question, index) => index === 0 ? `  ${question}  ` : question),
      }),
    });
    await expect(service.analyze(input)).resolves.toMatchObject({ tailoredQuestions });
  });

  it.each([
    ["fewer than eight", tailoredQuestions.slice(0, 7)],
    ["duplicate", [...tailoredQuestions.slice(0, 7), tailoredQuestions[0]]],
    ["Portuguese", [...tailoredQuestions.slice(0, 7), "Como você investigaria um incidente em produção?"]],
    ["multiple questions", [...tailoredQuestions.slice(0, 7), "How do you test APIs? And how do you report bugs?"]],
  ])("rejects an incomplete tailored plan after validation (%s)", async (_case, questions) => {
    const service = new OpenRouterJobDirectionService({ key: "k", model: "m", timeoutMs: 1_000, fetchImplementation: async () => providerResponse({ ...direction, tailoredQuestions: questions }) });
    await expect(service.analyze(input)).rejects.toMatchObject({ code: "JOB_DIRECTION_INVALID_PROVIDER_RESPONSE" });
  });
});
