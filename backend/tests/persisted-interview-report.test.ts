import { EventEmitter } from "node:events";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { InterviewReport, InterviewReportService } from "../src/thinking/types.js";
import { createPersistedInterviewReportController } from "../src/controllers/persisted-interview-report-controller.js";
import { requireAccessToken } from "../src/middlewares/require-access-token.js";
import { createPersistedInterviewReportService, createSupabaseReportPersistence, type ReportPersistence } from "../src/thinking/persisted-interview-report.js";
import type { AccessTokenVerifier } from "../src/auth/access-token-verifier.js";

const interviewId = "2d9f3d8d-4347-4e2c-b8a2-3378782be2da";
const token = "valid-user-token";
const report: InterviewReport = {
  technicalContent: { summary: "Explained the deployment.", strengths: [], gaps: [] },
  englishCommunication: { clarity: "CLEAR", evidenceStatus: "NO_PATTERN_FOUND", patterns: [] },
  priorities: [],
};

function store(initial: { status: "pending" | "ready" | "unavailable"; analysis?: InterviewReport | null } = { status: "unavailable" }) {
  let feedback: any = initial.status === "ready" ? { status: "ready", analysis: initial.analysis ?? report, model: "saved-model", analysis_version: "v2", azure_summary: null } : { status: initial.status, analysis: null, azure_summary: null };
  const stateChanges: string[] = [];
  const persistence: ReportPersistence = {
    loadInterview: vi.fn(async () => ({ id: interviewId, target_role: "Backend Engineer", seniority: "senior", focus: "technical-depth", job_direction: null, status: "completed" })),
    loadTurns: vi.fn(async () => [
      { sequence_number: 1, speaker: "interviewer" as const, content: "How did you deploy it?" },
      { sequence_number: 2, speaker: "candidate" as const, content: "I used blue green deployment." },
    ]),
    loadFeedback: vi.fn(async () => feedback),
    ensurePending: vi.fn(async (_token, _interviewId, azureSummary) => {
      if (feedback.status !== "ready") feedback = { status: "pending", analysis: null, azure_summary: azureSummary ?? feedback.azure_summary };
      stateChanges.push(feedback.status);
      return feedback;
    }),
    saveReady: vi.fn(async (_token, _interviewId, next, model, analysisVersion) => {
      if (feedback.status !== "ready") feedback = { status: "ready", analysis: next, model, analysis_version: analysisVersion, azure_summary: feedback.azure_summary };
      stateChanges.push(feedback.status);
      return feedback;
    }),
    markUnavailable: vi.fn(async () => {
      if (feedback.status !== "ready") feedback = { ...feedback, status: "unavailable", analysis: null };
      stateChanges.push(feedback.status);
    }),
  };
  return { persistence, get feedback() { return feedback; }, stateChanges };
}

const serviceStub = (generate = vi.fn(async () => ({ ...report, model: "test-model", analysisVersion: "v2" }))) => ({
  generate,
  analyzeTurn: vi.fn(),
  consolidate: vi.fn(),
}) as unknown as InterviewReportService;

describe("persisted interview reports", () => {
  it("forwards the user's bearer and publishable key to every RLS-scoped REST request", async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify([{ id: interviewId }]), { status: 200, headers: { "content-type": "application/json" } });
    };
    const persistence = createSupabaseReportPersistence({ supabaseUrl: "https://example.supabase.co", publishableKey: "sb_publishable_test", fetchImpl });

    await persistence.loadInterview(token, interviewId);
    await persistence.loadTurns(token, interviewId);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain(`/rest/v1/interviews?select=id,target_role,seniority,focus,job_direction,status&id=eq.${interviewId}`);
    expect(calls[1]?.url).toContain(`/rest/v1/interview_turns?select=sequence_number,speaker,content&interview_id=eq.${interviewId}&order=sequence_number.asc`);
    for (const call of calls) {
      expect(call.headers.get("apikey")).toBe("sb_publishable_test");
      expect(call.headers.get("authorization")).toBe(`Bearer ${token}`);
      expect(call.url).not.toContain("user_id=");
    }
  });

  it("uses conditional status filters so late completion and retry cannot overwrite ready", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const ready = { status: "ready", analysis: report, model: "first", analysis_version: "v2", generated_at: "2026-10-20T00:00:00Z", azure_summary: null };
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      if (init?.method === "PATCH") return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify([ready]), { status: 200, headers: { "content-type": "application/json" } });
    };
    const persistence = createSupabaseReportPersistence({ supabaseUrl: "https://example.supabase.co", publishableKey: "public", fetchImpl });

    const lateSave = await persistence.saveReady(token, interviewId, report, "late", "v2");
    const retry = await persistence.ensurePending(token, interviewId, null);

    expect(lateSave.model).toBe("first");
    expect(retry.status).toBe("ready");
    expect(calls[0]?.url).toContain("status=neq.ready");
    expect(calls[0]?.body).toContain('"status":"ready"');
    expect(calls[1]?.method).toBe("GET");
    expect(calls[2]?.method).toBe("GET");
    expect(calls.every((call) => call.method !== "PATCH" || call.url.includes("status=neq.ready"))).toBe(true);
  });

  it("requires authentication and starts the persistent endpoint with the verified user's bearer", async () => {
    const generate = vi.fn(async (receivedToken: string) => {
      expect(receivedToken).toBe(token);
      return { status: "ready", report };
    });
    const verifier: AccessTokenVerifier = { verify: vi.fn(async (candidate) => {
      if (candidate !== token) throw new Error("bad token");
      return { userId: "user-private-id" };
    }) };
    const app = express();
    app.use(express.json());
    app.use("/api", requireAccessToken(verifier));
    app.post("/api/report/:interviewId", createPersistedInterviewReportController({ generate }));

    const unauthorized = await request(app).post(`/api/report/${interviewId}`).send({ locale: "en" });
    expect(unauthorized.status).toBe(401);
    const response = await request(app).post(`/api/report/${interviewId}`).set("authorization", `Bearer ${token}`).send({ locale: "en" });
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("shares concurrent generation for one interview and persists pending then ready once", async () => {
    const data = store();
    let finish!: (value: InterviewReport & { model: string; analysisVersion: "v2" }) => void;
    const gate = new Promise<InterviewReport & { model: string; analysisVersion: "v2" }>((resolve) => { finish = resolve; });
    const generate = vi.fn(() => gate);
    const generator = createPersistedInterviewReportService(serviceStub(generate), data.persistence);
    const first = generator.generate(token, interviewId, { locale: "en" }, "user-a");
    const second = generator.generate(token, interviewId, { locale: "en" }, "user-a");
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    finish({ ...report, model: "test-model", analysisVersion: "v2" });

    const [one, two] = await Promise.all([first, second]);
    expect(one).toEqual(two);
    expect(one.status).toBe("ready");
    expect(data.stateChanges).toEqual(["pending", "ready"]);
    expect(data.persistence.saveReady).toHaveBeenCalledOnce();
  });

  it("keeps concurrent users isolated in the in-process idempotency map", async () => {
    const data = store();
    const generate = vi.fn(async () => ({ ...report, model: "test-model", analysisVersion: "v2" }));
    const generator = createPersistedInterviewReportService(serviceStub(generate), data.persistence);
    await Promise.all([
      generator.generate(token, interviewId, { locale: "en" }, "user-a"),
      generator.generate("other-token", interviewId, { locale: "en" }, "user-b"),
    ]);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("returns an existing ready report without generation or state changes", async () => {
    const data = store({ status: "ready", analysis: report });
    const generate = vi.fn();
    const generator = createPersistedInterviewReportService(serviceStub(generate), data.persistence);
    const result = await generator.generate(token, interviewId, { locale: "en" }, "user-a");
    expect(result.report.technicalContent).toEqual(report.technicalContent);
    expect(generate).not.toHaveBeenCalled();
    expect(data.persistence.ensurePending).not.toHaveBeenCalled();
    expect(data.persistence.saveReady).not.toHaveBeenCalled();
  });

  it("marks a report unavailable after generation failure so the user can retry", async () => {
    const data = store();
    const generator = createPersistedInterviewReportService(serviceStub(vi.fn(async () => { throw new Error("provider failed"); })), data.persistence);
    await expect(generator.generate(token, interviewId, { locale: "pt-BR" }, "user-a")).rejects.toThrow("provider failed");
    expect(data.persistence.markUnavailable).toHaveBeenCalledOnce();
    expect(data.feedback.status).toBe("unavailable");
  });

  it("does not regress ready when a later failure tries to mark it unavailable", async () => {
    const data = store({ status: "ready", analysis: report });
    await data.persistence.markUnavailable(token, interviewId);
    expect(data.feedback.status).toBe("ready");
    expect(data.stateChanges).toEqual(["ready"]);
  });

  it("keeps generation alive after the HTTP request is aborted", async () => {
    const emitter = new EventEmitter();
    let resolvePending!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => { resolvePending = resolve; });
    const generate = vi.fn(() => pending);
    const controller = createPersistedInterviewReportController({ generate });
    const req = Object.assign(emitter, { headers: { authorization: `Bearer ${token}` }, params: { interviewId }, body: { locale: "en" } });
    const body = vi.fn();
    const res = { locals: { authenticatedUser: { userId: "user-a" } }, destroyed: false, status: vi.fn().mockReturnThis(), json: body };
    const handling = controller(req as never, res as never, vi.fn());
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    emitter.emit("aborted");
    res.destroyed = true;
    resolvePending({ status: "ready", report });
    await handling;
    expect(generate).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });
});
