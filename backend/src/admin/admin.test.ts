import { describe, expect, it, vi } from "vitest";

import { AdminUsageService } from "./usage-service.js";
import { createAdminStatusHandler, createAdminUsageHandler } from "../routes/admin.routes.js";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("AdminUsageService", () => {
  it("marks providers without their configuration as not configured", async () => {
    const service = new AdminUsageService({ env: {}, fetchImpl: vi.fn() as unknown as typeof fetch });
    const usage = await service.getUsage();
    expect(usage.sources.map((source) => [source.id, source.status])).toEqual([
      ["openrouter", "not_configured"], ["azure", "not_configured"], ["gcp_billing", "not_configured"], ["gcp_run", "not_configured"],
    ]);
  });

  it("returns OpenRouter credits and caches the complete response for one minute", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => String(url).includes("openrouter.ai") ? response({ data: { total_credits: 10, total_usage: 2.5 } }) : response({}, 404)) as unknown as typeof fetch;
    let time = new Date("2026-10-17T12:00:00.000Z");
    const service = new AdminUsageService({ fetchImpl, now: () => time, env: { OPENROUTER_API_KEY: "test" } });
    const first = await service.getUsage(); const second = await service.getUsage();
    expect(first.sources.find((source) => source.id === "openrouter")?.metrics).toEqual(expect.arrayContaining([expect.objectContaining({ id: "total_credits", value: 10 }), expect.objectContaining({ id: "remaining", value: 7.5 })]));
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    time = new Date("2026-10-17T12:01:01.000Z");
    await service.getUsage();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("contains upstream failures and timeouts within the affected source", async () => {
    const failed = new AdminUsageService({ fetchImpl: vi.fn(async () => response({}, 500)) as unknown as typeof fetch, env: { OPENROUTER_API_KEY: "test" } });
    await expect(failed.getUsage()).resolves.toMatchObject({ sources: expect.arrayContaining([expect.objectContaining({ id: "openrouter", status: "error" })]) });
    const hanging = new AdminUsageService({ fetchImpl: vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch, timeoutMs: 1, env: { OPENROUTER_API_KEY: "test" } });
    await expect(hanging.getUsage()).resolves.toMatchObject({ sources: expect.arrayContaining([expect.objectContaining({ id: "openrouter", status: "error" })]) });
  });

  it("normalizes Azure Monitor, BigQuery billing, and Cloud Run Monitoring usage", async () => {
    let loggingFilter = "";
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const value = String(url);
      if (value.includes("login.microsoftonline.com")) return response({ access_token: "azure-token" });
      if (value.includes("management.azure.com") && value.includes("TotalCalls")) return response({ value: [{ timeseries: [{ data: [{ total: 40 }, { total: 2 }] }] }] });
      if (value.includes("management.azure.com")) return response({ value: [{ timeseries: [{ data: [{ total: 3 }] }] }] });
      if (value.includes("logging.googleapis.com")) {
        loggingFilter = JSON.parse(String(init?.body)).filter;
        const page = JSON.parse(String(init?.body)).pageToken;
        return page
          ? response({ entries: [{ jsonPayload: { event: "practice_assessment", assessedDurationMs: 5_400_000 } }] })
          : response({ entries: [{ jsonPayload: { event: "speech_usage", chars: 1000 } }, { jsonPayload: { event: "speech_usage", chars: 200 } }, { jsonPayload: { event: "azure_assessment", assessedDurationMs: 1_800_000 } }], nextPageToken: "next" });
      }
      if (value.includes("metadata.google.internal")) return response({ access_token: "gcp-token" });
      if (value.includes("bigquery.googleapis.com")) return response({ rows: [{ f: [{ v: "Cloud Run" }, { v: "12.5" }, { v: "USD" }] }] });
      if (value.includes("billable_instance_time")) return response({ timeSeries: [{ resource: { labels: { service_name: "english-interview-backend" } }, points: [{ value: { doubleValue: 7200 } }] }] });
      return response({ timeSeries: [{ resource: { labels: { service_name: "english-interview-backend" } }, points: [{ value: { int64Value: "4" } }] }] });
    }) as unknown as typeof fetch;
    const usage = await new AdminUsageService({ fetchImpl, env: {
      AZURE_MONITOR_TENANT_ID: "tenant", AZURE_MONITOR_CLIENT_ID: "client", AZURE_MONITOR_CLIENT_SECRET: "secret", AZURE_SPEECH_RESOURCE_ID: "subscriptions/x/resourceGroups/y/providers/Microsoft.CognitiveServices/accounts/z",
      GCP_BILLING_EXPORT_TABLE: "project.dataset.table", GCP_PROJECT_ID: "project",
    } }).getUsage();
    expect(usage.sources.find((source) => source.id === "azure")).toMatchObject({ status: "ok", metrics: [expect.objectContaining({ id: "tts_characters", value: 1200 }), expect.objectContaining({ id: "stt_audio", value: 2 }), expect.objectContaining({ id: "total_calls", value: 42 }), expect.objectContaining({ id: "blocked_calls", value: 3 })] });
    expect(loggingFilter).toContain('jsonPayload.event="practice_assessment"');
    expect(usage.sources.find((source) => source.id === "gcp_billing")).toMatchObject({ status: "ok", metrics: expect.arrayContaining([expect.objectContaining({ id: "month_cost", value: 12.5, unit: "USD" })]) });
    expect(usage.sources.find((source) => source.id === "gcp_run")).toMatchObject({ status: "ok", metrics: expect.arrayContaining([expect.objectContaining({ id: "english_interview_backend_billable_instance_time", value: 2 }), expect.objectContaining({ id: "english_interview_backend_request_count", value: 4 })]) });
  });
});

describe("AdminUsageService GCP edge cases", () => {
  it("shows a missing billing export table as pending and queries Monitoring with valid parameters", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      urls.push(String(url));
      if (String(url).includes("bigquery.googleapis.com")) return response({ error: { code: 404 } }, 404);
      return response({ timeSeries: [] });
    }) as unknown as typeof fetch;
    const usage = await new AdminUsageService({ fetchImpl, env: { GOOGLE_ACCESS_TOKEN: "t", GCP_PROJECT_ID: "project", GCP_BILLING_EXPORT_TABLE: "project.dataset.table" } }).getUsage();
    expect(usage.sources.find((source) => source.id === "gcp_billing")).toMatchObject({ status: "not_configured", setupHint: expect.stringContaining("Aguardando") });
    const monitoring = new URL(urls.find((url) => url.includes("monitoring.googleapis.com"))!);
    expect(monitoring.searchParams.get("interval.startTime")).toBeTruthy();
    expect(monitoring.searchParams.get("aggregation.crossSeriesReducer")).toBe("REDUCE_SUM");
  });
});

describe("admin routes", () => {
  it("reports admin status to any authenticated user and rejects non-admin usage", async () => {
    let body: unknown; let code = 200;
    const response = { locals: { authenticatedUser: { userId: "member" } }, status: (status: number) => { code = status; return response; }, json: (value: unknown) => { body = value; return response; } };
    createAdminStatusHandler("owner")({} as never, response as never, vi.fn());
    expect(body).toEqual({ admin: false });
    await createAdminUsageHandler(new AdminUsageService({ env: {} }), "owner")({ query: {} } as never, response as never, vi.fn());
    expect(code).toBe(403);
    expect(body).toEqual({ error: expect.objectContaining({ code: "FORBIDDEN" }) });
  });
});
