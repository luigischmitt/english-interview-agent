import { authorizedFetch } from "@/lib/auth/backend-auth";
import { requestPersistedReport } from "./persisted-report-request.mjs";
import type { AzureMetricSummary } from "./report-metrics.mjs";
import type { InterviewReportResult } from "./report";

export async function requestPersistedInterviewReport(
  interviewId: string,
  azureSummary: AzureMetricSummary | null,
  locale: "pt-BR" | "en",
  fetcher: typeof fetch = authorizedFetch,
  endpoint = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001",
): Promise<InterviewReportResult> {
  return requestPersistedReport(interviewId, azureSummary, locale, fetcher, endpoint) as Promise<InterviewReportResult>;
}
