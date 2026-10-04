import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { defaultThinkingModel } from "../src/thinking/config.js";
import { OpenRouterInterviewReportService } from "../src/thinking/openrouter-interview-report-service.js";
import { expectPrecisionRules } from "./report-prompt-assertions.js";
import type { InterviewReportConsolidationInput, InterviewTurnAnalysis } from "../src/thinking/types.js";
import type { SpeechConfig } from "../src/speech/config.js";

const speechConfig: SpeechConfig = {
  provider: "fake", kokoroBaseUrl: "http://localhost:8888", kokoroTimeoutMs: 1000,
  interviewerVoice: "af_bella+af_heart", defaultSpeed: 1, format: "mp3",
};
const roleContext = { targetRole: "Backend Engineer", seniority: "mid-level", focus: "technical-depth" };
const turns = [
  { sequenceNumber: 2, question: "How would you improve reliability?", answer: "I would add timeouts and bounded retries. Yesterday I have deployed the service." },
  { sequenceNumber: 4, question: "How do you monitor it?", answer: "We monitor errors and latency in production." },
];
const strength2 = { sequenceNumber: 2, evidence: "bounded retries", explanation: "Nomeia uma proteção para tentativas repetidas." };
const gap4 = { sequenceNumber: 4, evidence: "monitor errors", explanation: "A resposta não explica limites ou alertas." };
const pattern2 = { type: "GRAMMAR" as const, sequenceNumber: 2, evidence: "Yesterday I have deployed", suggestion: "Use o passado simples com marcadores de tempo passado.", rephrasedExample: "Yesterday I deployed the service." };
const analyses: InterviewTurnAnalysis[] = [
  { sequenceNumber: 2, technicalStrengths: [strength2], technicalGaps: [], englishPatterns: [pattern2] },
  { sequenceNumber: 4, technicalStrengths: [], technicalGaps: [gap4], englishPatterns: [] },
];
const sentinel = "SENTINEL-SECRET-ANSWER-TEXT";

function providerResponse(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status });
}
function makeService(fetchImplementation: typeof fetch) {
  return new OpenRouterInterviewReportService({ key: "test-key", model: defaultThinkingModel, timeoutMs: 1234, fetchImplementation });
}
function capture(content: unknown) {
  const bodies: Array<Record<string, any>> = [];
  const fetchImplementation: typeof fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return providerResponse(content); };
  return { bodies, fetchImplementation };
}
function timingEvents(info: { mock: { calls: unknown[][] } }) {
  return info.mock.calls.flatMap(([entry]) => {
    if (typeof entry !== "string") return [];
    const event = JSON.parse(entry) as Record<string, unknown>;
    return event.event === "interview_report_phase_timing" ? [event] : [];
  });
}

describe("per-turn analysis service", () => {
  it("makes one privacy-routed request and returns only validated items for that turn", async () => {
    const { bodies, fetchImplementation } = capture({
      technicalStrengths: [strength2, { ...strength2, evidence: "not in the answer" }, { ...gap4 }],
      technicalGaps: [],
      englishPatterns: [{ ...pattern2, evidence: "yesterday i have deployed" }, { ...pattern2, sequenceNumber: 4 }],
    });
    const result = await makeService(fetchImplementation).analyzeTurn({ roleContext, turn: turns[0] });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      model: defaultThinkingModel, temperature: 0,
      provider: { sort: "latency", require_parameters: true, data_collection: "deny" },
      response_format: { type: "json_schema", json_schema: { name: "interview_turn_analysis", strict: true } },
    });
    expect(bodies[0].max_tokens).toBeLessThanOrEqual(2_048);
    expectPrecisionRules(bodies[0].messages[0].content);
    expect(JSON.parse(bodies[0].messages[1].content)).toEqual({ roleContext, turns: [turns[0]] });
    expect(result).toEqual({
      sequenceNumber: 2,
      technicalStrengths: [strength2],
      technicalGaps: [],
      englishPatterns: [pattern2],
      model: defaultThinkingModel,
    });
  });

  it("maps provider failures to standardized thinking errors", async () => {
    const call = (fetchImplementation: typeof fetch) => makeService(fetchImplementation).analyzeTurn({ roleContext, turn: turns[0] });
    await expect(call(async () => new Response("", { status: 429 }))).rejects.toMatchObject({ code: "THINKING_RATE_LIMITED", status: 503 });
    await expect(call(async () => new Response("", { status: 500 }))).rejects.toMatchObject({ code: "THINKING_PROVIDER_UNAVAILABLE", status: 502 });
    await expect(call(async () => { throw new DOMException("t", "TimeoutError"); })).rejects.toMatchObject({ code: "THINKING_TIMEOUT", status: 504 });
    await expect(call(async () => providerResponse("not json"))).rejects.toMatchObject({ code: "THINKING_INVALID_PROVIDER_RESPONSE", status: 502 });
    await expect(call(async () => providerResponse({ technicalStrengths: [], technicalGaps: [], englishPatterns: [], extra: 1 }))).rejects.toMatchObject({ code: "THINKING_INVALID_PROVIDER_RESPONSE" });
  });

  it("logs content-free timings scoped to the turn", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const answer = `I used ${sentinel} in production.`;
      const { fetchImplementation } = capture({ technicalStrengths: [{ sequenceNumber: 2, evidence: sentinel, explanation: "Descreve o uso em produção." }], technicalGaps: [], englishPatterns: [] });
      await makeService(fetchImplementation).analyzeTurn({ roleContext, turn: { sequenceNumber: 2, question: `Question ${sentinel}?`, answer } });
      const events = timingEvents(info);
      expect(events.map(({ phase }) => phase)).toEqual(["provider", "validation"]);
      for (const event of events) {
        expect(event.scope).toBe("turn");
        expect(Object.keys(event).sort()).toEqual(["durationMs", "event", "phase", "scope", "turnCount"]);
      }
      expect(JSON.stringify(info.mock.calls)).not.toContain(sentinel);
    } finally { info.mockRestore(); }
  });
});

describe("consolidation service", () => {
  const consolidationOutput = {
    summary: "Descreve timeouts, retries limitados e monitoramento de erros e latência.",
    clarity: "MOSTLY_CLEAR",
    priorities: [
      { area: "ENGLISH_COMMUNICATION", sequenceNumber: 2, evidence: "Yesterday I have deployed", focus: "Passado simples", exercise: "Conte um deploy recente usando apenas o passado simples." },
      { area: "TECHNICAL_CONTENT", sequenceNumber: 4, evidence: "monitor errors", focus: "Limites de alerta", exercise: "Explique em um minuto quais limites acionariam um alerta." },
    ],
  };
  const consolidationInput: InterviewReportConsolidationInput = { roleContext, turns, turnAnalyses: analyses };

  it("returns the exact InterviewReport v2 shape with one small request", async () => {
    const { bodies, fetchImplementation } = capture(consolidationOutput);
    const result = await makeService(fetchImplementation).consolidate(consolidationInput);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      temperature: 0,
      provider: { sort: "latency", require_parameters: true, data_collection: "deny" },
      response_format: { type: "json_schema", json_schema: { name: "interview_report_consolidation", strict: true } },
    });
    expect(bodies[0].max_tokens).toBeLessThanOrEqual(1_536);
    expect(Object.keys(bodies[0].response_format.json_schema.schema.properties).sort()).toEqual(["clarity", "priorities", "summary"]);
    // ENG-113: the consolidation (which decides clarity) must carry the transcription-error guard.
    expect(bodies[0].messages[0].content).toContain("a transcription error must never become the candidate's error");
    expect(bodies[0].messages[0].content).toContain("Do not lower clarity because of garbled");
    expect(Object.keys(result).sort()).toEqual(["analysisVersion", "englishCommunication", "evidenceReview", "model", "priorities", "technicalContent"]);
    expect(result.analysisVersion).toBe("v2");
    expect(result.model).toBe(defaultThinkingModel);
    expect(result.technicalContent).toEqual({ summary: consolidationOutput.summary, strengths: [strength2], gaps: [gap4] });
    expect(result.englishCommunication).toEqual({ clarity: "MOSTLY_CLEAR", evidenceStatus: "LIMITED", patterns: [pattern2] });
    expect(result.priorities).toHaveLength(2);
    expect(result.evidenceReview?.technicalStrengths).toMatchObject({ candidates: 1, accepted: 1, rejected: 0 });
    expect(result.evidenceReview?.englishPatterns).toMatchObject({ candidates: 1, accepted: 1, rejected: 0 });
    expect(result.evidenceReview?.priorities).toMatchObject({ candidates: 2, accepted: 2, rejected: 0 });
    expect(Object.keys(result.evidenceReview?.priorities.rejectionReasons ?? {}).sort()).toEqual(["artifact", "duplicate", "invalidFormat", "limit", "mismatch"]);
  });

  it("re-validates tampered client items, sends only validated findings to the provider, and counts rejections", async () => {
    const tampered: InterviewTurnAnalysis[] = [
      { ...analyses[0], technicalStrengths: [strength2, { ...strength2, evidence: "invented excerpt" }, { ...gap4 }], technicalGaps: [{ sequenceNumber: 2, evidence: "timeouts", explanation: "Sem pontuação final e cortada por" }], englishPatterns: [] },
      { ...analyses[1], englishPatterns: [{ ...pattern2, sequenceNumber: 4 }, { ...pattern2, evidence: "Ooooo uh uh" , sequenceNumber: 4 }] },
    ];
    const { bodies, fetchImplementation } = capture(consolidationOutput);
    const result = await makeService(fetchImplementation).consolidate({ roleContext, turns, turnAnalyses: tampered });
    const sent = JSON.parse(bodies[0].messages[1].content).validatedFindings;
    expect(sent.technicalStrengths).toEqual([strength2]);
    expect(sent.technicalGaps).toEqual([gap4]);
    expect(sent.englishPatterns).toEqual([]);
    expect(result.technicalContent.strengths).toEqual([strength2]);
    expect(result.englishCommunication.patterns).toEqual([]);
    expect(result.englishCommunication.evidenceStatus).toBe("CANDIDATES_REJECTED");
    expect(result.evidenceReview?.technicalStrengths).toMatchObject({ candidates: 3, accepted: 1, rejected: 2 });
    expect(result.evidenceReview?.technicalStrengths.rejectionReasons?.mismatch).toBe(2);
    expect(result.evidenceReview?.englishPatterns).toMatchObject({ candidates: 2, accepted: 0, rejected: 2 });
    expect(result.evidenceReview?.technicalGaps).toMatchObject({ candidates: 2, accepted: 1, rejected: 1 });
    // The English priority lost its validated pattern; the technical one still builds on gap 4.
    expect(result.priorities.map(({ area }) => area)).toEqual(["TECHNICAL_CONTENT"]);
    expect(result.evidenceReview?.priorities).toMatchObject({ candidates: 2, accepted: 1, rejected: 1 });
  });

  it("rejects priorities that do not build on a validated finding or whose evidence is not in the answer", async () => {
    const { fetchImplementation } = capture({
      ...consolidationOutput,
      priorities: [
        { ...consolidationOutput.priorities[1], sequenceNumber: 2, evidence: "timeouts" },
        { ...consolidationOutput.priorities[1], evidence: "made up words" },
        consolidationOutput.priorities[1],
      ],
    });
    const result = await makeService(fetchImplementation).consolidate({ roleContext, turns, turnAnalyses: [{ ...analyses[0], englishPatterns: [] }, analyses[1]] });
    // sequenceNumber 2 has a validated technical strength, so the first one is allowed.
    expect(result.priorities.map(({ sequenceNumber, evidence }) => [sequenceNumber, evidence])).toEqual([[2, "timeouts"], [4, "monitor errors"]]);
    expect(result.evidenceReview?.priorities).toMatchObject({ candidates: 3, accepted: 2, rejected: 1 });
    expect(result.evidenceReview?.priorities.rejectionReasons?.mismatch).toBe(1);
  });

  it("dedupes patterns across turns and caps every list at the full-report limits", async () => {
    const manyTurns = Array.from({ length: 6 }, (_, index) => ({ sequenceNumber: index + 1, question: "Q?", answer: "I have deployed yesterday. We use queue for jobs. The team are small." }));
    const item = (sequenceNumber: number, evidence: string) => ({ type: "GRAMMAR", sequenceNumber, evidence, suggestion: "Use a forma correta do verbo nesta frase.", rephrasedExample: "I deployed it yesterday." });
    const evidences = ["I have deployed yesterday", "We use queue for jobs", "The team are small", "have deployed", "use queue", "team are", "We use queue", "The team"];
    const perTurn = manyTurns.map((turn, index) => ({
      sequenceNumber: turn.sequenceNumber,
      technicalStrengths: Array.from({ length: 3 }, () => ({ sequenceNumber: turn.sequenceNumber, evidence: "We use queue", explanation: "Usa uma fila para processar trabalhos." })),
      technicalGaps: [],
      englishPatterns: index === 0 ? [item(1, evidences[0]), item(1, evidences[0].toUpperCase())] : evidences.map((evidence) => item(turn.sequenceNumber, evidence)),
    }));
    const { fetchImplementation } = capture({ summary: "Resumo técnico completo e objetivo.", clarity: "CLEAR", priorities: [] });
    const result = await makeService(fetchImplementation).consolidate({ roleContext, turns: manyTurns, turnAnalyses: perTurn as InterviewTurnAnalysis[] });
    expect(result.technicalContent.strengths).toHaveLength(8);
    expect(result.evidenceReview?.technicalStrengths.rejectionReasons?.limit).toBe(10);
    expect(result.englishCommunication.patterns).toHaveLength(8);
    expect(result.englishCommunication.evidenceStatus).toBe("SUFFICIENT");
    const reasons = result.evidenceReview?.englishPatterns.rejectionReasons;
    expect(reasons?.duplicate).toBeGreaterThanOrEqual(1);
    expect(reasons?.limit).toBeGreaterThanOrEqual(1);
    const signatures = result.englishCommunication.patterns.map((pattern) => `${pattern.sequenceNumber}:${pattern.evidence.toLowerCase()}`);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("maps provider failures to standardized errors and logs content-free consolidate timings", async () => {
    const service = (fetchImplementation: typeof fetch) => makeService(fetchImplementation).consolidate(consolidationInput);
    await expect(service(async () => new Response("", { status: 429 }))).rejects.toMatchObject({ code: "THINKING_RATE_LIMITED" });
    await expect(service(async () => new Response("", { status: 502 }))).rejects.toMatchObject({ code: "THINKING_PROVIDER_UNAVAILABLE" });
    await expect(service(async () => { throw new DOMException("t", "AbortError"); })).rejects.toMatchObject({ code: "THINKING_TIMEOUT" });
    await expect(service(async () => providerResponse({ summary: "Resumo completo.", clarity: "WRONG", priorities: [] }))).rejects.toMatchObject({ code: "THINKING_INVALID_PROVIDER_RESPONSE" });

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const secretTurns = [{ sequenceNumber: 2, question: `Why ${sentinel}?`, answer: `Because ${sentinel} works.` }];
      const { fetchImplementation } = capture({ summary: "Resumo completo e claro.", clarity: "CLEAR", priorities: [] });
      await makeService(fetchImplementation).consolidate({ roleContext, turns: secretTurns, turnAnalyses: [{ sequenceNumber: 2, technicalStrengths: [{ sequenceNumber: 2, evidence: sentinel, explanation: "Justifica a escolha." }], technicalGaps: [], englishPatterns: [] }] });
      const events = timingEvents(info);
      expect(events.map(({ phase, scope }) => `${scope}:${phase}`)).toEqual(["consolidate:provider", "consolidate:validation"]);
      expect(JSON.stringify(info.mock.calls)).not.toContain(sentinel);
    } finally { info.mockRestore(); }
  });
});

describe("incremental report routes", () => {
  const turnResult = { ...analyses[0], model: defaultThinkingModel };
  const consolidated = { technicalContent: { summary: "Resumo.", strengths: [], gaps: [] }, englishCommunication: { clarity: "CLEAR", evidenceStatus: "NO_PATTERN_FOUND", patterns: [] }, priorities: [], model: defaultThinkingModel, analysisVersion: "v2" };
  const makeApp = () => {
    const reportService = { generate: vi.fn(), analyzeTurn: vi.fn(async () => turnResult), consolidate: vi.fn(async () => consolidated) };
    return { reportService, app: createApp({ speechConfig, reportService: reportService as never }) };
  };

  it("POST /report/turn validates the body before calling the provider", async () => {
    const { app, reportService } = makeApp();
    const ok = await request(app).post("/api/v1/thinking/report/turn").send({ roleContext, turn: turns[0] });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(turnResult);
    expect(reportService.analyzeTurn).toHaveBeenCalledWith({ roleContext, turn: turns[0] });

    const bad = [
      { roleContext, turn: turns[0], interviewId: "private-db-id" },
      { roleContext, turn: { ...turns[0], interviewId: "x" } },
      { roleContext, turn: { ...turns[0], answer: "" } },
      { roleContext, turn: { ...turns[0], answer: "a".repeat(5_001) } },
      { roleContext, turn: { ...turns[0], question: "q".repeat(501) } },
      { roleContext, turn: { ...turns[0], sequenceNumber: 0 } },
      { roleContext: { ...roleContext, targetRole: "" }, turn: turns[0] },
      { roleContext },
      { roleContext, turns },
    ];
    for (const body of bad) expect((await request(app).post("/api/v1/thinking/report/turn").send(body)).status).toBe(400);
    expect(reportService.analyzeTurn).toHaveBeenCalledTimes(1);
  });

  it("POST /report/consolidate validates the envelope and requires one analysis per turn", async () => {
    const { app, reportService } = makeApp();
    const body = { roleContext, turns, turnAnalyses: analyses };
    const ok = await request(app).post("/api/v1/thinking/report/consolidate").send(body);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(consolidated);
    expect(reportService.consolidate).toHaveBeenCalledWith(body);

    const bad = [
      { ...body, interviewId: "private-db-id" },
      { ...body, turnAnalyses: [analyses[0]] },
      { ...body, turnAnalyses: [analyses[0], analyses[0]] },
      { ...body, turnAnalyses: [analyses[0], { ...analyses[1], sequenceNumber: 9 }] },
      { ...body, turnAnalyses: [analyses[0], { ...analyses[1], model: "x" }] },
      { ...body, turnAnalyses: [analyses[0], { ...analyses[1], englishPatterns: Array.from({ length: 9 }, () => ({})) }] },
      { ...body, turnAnalyses: [analyses[0], { ...analyses[1], technicalGaps: "no" }] },
      { ...body, turns: [...turns].reverse() },
      { ...body, turns: [] },
    ];
    for (const invalid of bad) expect((await request(app).post("/api/v1/thinking/report/consolidate").send(invalid)).status).toBe(400);
    expect(reportService.consolidate).toHaveBeenCalledTimes(1);
  });

  it("returns standardized errors for missing configuration and provider failures", async () => {
    const unconfigured = createApp({ speechConfig, reportService: null });
    for (const [path, body] of [["turn", { roleContext, turn: turns[0] }], ["consolidate", { roleContext, turns, turnAnalyses: analyses }]] as const) {
      const response = await request(unconfigured).post(`/api/v1/thinking/report/${path}`).send(body);
      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe("THINKING_NOT_CONFIGURED");
    }
    const service = makeService(async () => new Response("", { status: 500 }));
    const app = createApp({ speechConfig, reportService: service });
    const turnResponse = await request(app).post("/api/v1/thinking/report/turn").send({ roleContext, turn: turns[0] });
    expect(turnResponse.status).toBe(502);
    expect(turnResponse.body).toEqual({ error: { code: "THINKING_PROVIDER_UNAVAILABLE", message: "The reasoning service is unavailable." } });
    const consolidateResponse = await request(app).post("/api/v1/thinking/report/consolidate").send({ roleContext, turns, turnAnalyses: analyses });
    expect(consolidateResponse.status).toBe(502);
    expect(consolidateResponse.body.error.code).toBe("THINKING_PROVIDER_UNAVAILABLE");
  });

  it("route logs never contain answers or questions", async () => {
    const spies = [vi.spyOn(console, "info"), vi.spyOn(console, "warn")].map((spy) => spy.mockImplementation(() => undefined));
    try {
      const secret = { sequenceNumber: 2, question: `Q ${sentinel}?`, answer: `A ${sentinel}.` };
      const app = createApp({ speechConfig, reportService: makeService(async () => new Response("", { status: 500 })) });
      await request(app).post("/api/v1/thinking/report/turn").send({ roleContext, turn: secret });
      await request(app).post("/api/v1/thinking/report/consolidate").send({ roleContext, turns: [secret], turnAnalyses: [{ sequenceNumber: 2, technicalStrengths: [], technicalGaps: [], englishPatterns: [] }] });
      expect(JSON.stringify(spies.map((spy) => spy.mock.calls))).not.toContain(sentinel);
    } finally { spies.forEach((spy) => spy.mockRestore()); }
  });
});
