import { describe, expect, it, vi } from "vitest";
import { OpenRouterJobDirectionService } from "./openrouter-job-direction-service.js";

const direction = {
  targetRole: "Backend Engineer",
  suggestedSeniority: "senior",
  mainInterviewEmphasis: "Arquitetura de APIs e decisões de confiabilidade.",
  priorityCompetencies: ["Sistemas distribuídos", "Observabilidade"],
  productTeamContext: "Plataforma B2B para logística; equipe de produto e engenharia.",
  suggestedFocus: "technical-depth",
};
const input = {
  jobDescription: "We are hiring a backend engineer to build distributed services, improve API reliability, and work with product on a logistics platform. " .repeat(2),
  roleContext: { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" },
};
const providerResponse = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });

describe("OpenRouter job direction service", () => {
  it("requests a strict, non-question direction and returns only validated fields", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return providerResponse(direction);
    });
    const service = new OpenRouterJobDirectionService({ key: "test-key", model: "mistral/test", timeoutMs: 1_000, fetchImplementation: fetcher });

    await expect(service.analyze(input)).resolves.toEqual(direction);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(requestBody?.model).toBe("mistral/test");
    expect(requestBody?.provider).toEqual({ require_parameters: true, data_collection: "deny" });
    expect(requestBody?.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true, name: "job_interview_direction" } });
    const messages = requestBody?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain("untrusted data");
    expect(messages[0]?.content).toContain("ENGLISH");
    expect(messages[0]?.content).toContain("Never write 'Não informado'");
    expect(messages[0]?.content).toContain("suggestedFocus");
    expect(messages[0]?.content).toContain("Do not generate, suggest, quote, or display interview questions");
    expect(messages[1]?.content).toContain(input.jobDescription);
    const jsonSchema = (requestBody?.response_format as { json_schema: { schema: { required: string[]; properties: Record<string, { enum?: string[] }> } } }).json_schema.schema;
    expect(jsonSchema.required).toContain("suggestedFocus");
    expect(jsonSchema.properties.suggestedFocus?.enum).toEqual(["technical-depth", "communication", "behavioral", "mixed"]);
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
});
