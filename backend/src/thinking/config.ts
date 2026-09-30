export const defaultThinkingModel = "mistralai/mistral-small-3.2-24b-instruct";
export const defaultThinkingTimeoutMs = 15_000;
export const defaultOrchestrationTimeoutMs = 6_000;
export const defaultInterviewReportTimeoutMs = 45_000;
export const defaultInterviewTurnAnalysisTimeoutMs = 20_000;
export const defaultInterviewConsolidationTimeoutMs = 25_000;

export type ThinkingConfig = {
  openRouterApiKey: string | null;
  model: string;
  /** Model for the final report; falls back to `model` when absent. */
  reportModel?: string;
  timeoutMs: number;
  orchestrationTimeoutMs: number;
  reportTimeoutMs?: number;
  diagnosticsEnabled: boolean;
};

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Interview reasoning timeout must be a positive number.");
  }

  return parsed;
}

function parseReportTimeout(value: string | undefined): number {
  const timeout = parsePositiveNumber(value, defaultInterviewReportTimeoutMs);
  if (timeout > 60_000) throw new Error("Interview report timeout must not exceed 60000 milliseconds.");
  return timeout;
}

export function loadThinkingConfig(environment = process.env): ThinkingConfig {
  const model = environment.INTERVIEW_REASONING_MODEL?.trim() || defaultThinkingModel;
  return {
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    model,
    reportModel: environment.INTERVIEW_REPORT_MODEL?.trim() || model,
    timeoutMs: parsePositiveNumber(environment.INTERVIEW_REASONING_TIMEOUT_MS, defaultThinkingTimeoutMs),
    orchestrationTimeoutMs: parsePositiveNumber(environment.INTERVIEW_ORCHESTRATION_TIMEOUT_MS, defaultOrchestrationTimeoutMs),
    reportTimeoutMs: parseReportTimeout(environment.INTERVIEW_REPORT_TIMEOUT_MS),
    diagnosticsEnabled: environment.INTERVIEW_REASONING_DIAGNOSTICS?.trim().toLowerCase() === "true",
  };
}
