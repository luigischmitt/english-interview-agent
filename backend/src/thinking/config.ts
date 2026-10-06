export const defaultThinkingModel = "mistralai/mistral-small-3.2-24b-instruct";
export const defaultThinkingTimeoutMs = 15_000;
export const defaultOrchestrationTimeoutMs = 6_000;
export const defaultOrchestrationHedgeAfterMs = 2_500;
export const defaultBridgeTimeoutMs = 1_800;
export const defaultInterviewReportTimeoutMs = 45_000;
export const defaultInterviewTurnAnalysisTimeoutMs = 30_000;
export const defaultInterviewConsolidationTimeoutMs = 25_000;

export type ThinkingConfig = {
  openRouterApiKey: string | null;
  model: string;
  /** Model for the final report; falls back to `model` when absent. */
  reportModel?: string;
  timeoutMs: number;
  orchestrationTimeoutMs: number;
  /** Start one identical hedge request after this many ms without a response; 0 disables. Defaults to 2500. */
  orchestrationHedgeAfterMs?: number;
  reportTimeoutMs?: number;
  /** Timeout of the small bridge call that follows a next-turn decision (300–5000 ms; defaults to 1800). */
  bridgeTimeoutMs?: number;
  /** Merge bridge writing into the decision call by default; `separate` keeps the rollback path. */
  bridgeMode?: "merged" | "separate";
  diagnosticsEnabled: boolean;
  speculativeHandoffEnabled?: boolean;
};

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Interview reasoning timeout must be a positive number.");
  }

  return parsed;
}

function parseNonNegativeNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Interview orchestration hedge delay must be zero or a positive number.");
  return parsed;
}

function parseReportTimeout(value: string | undefined): number {
  const timeout = parsePositiveNumber(value, defaultInterviewReportTimeoutMs);
  if (timeout > 60_000) throw new Error("Interview report timeout must not exceed 60000 milliseconds.");
  return timeout;
}

function normalizeBridgeTimeout(value: string | undefined): number {
  const parsed = value === undefined || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? Math.min(5_000, Math.max(300, Math.round(parsed))) : defaultBridgeTimeoutMs;
}

function parseBridgeMode(value: string | undefined): "merged" | "separate" {
  const mode = value?.trim().toLowerCase() || "merged";
  if (mode !== "merged" && mode !== "separate") throw new Error("INTERVIEW_BRIDGE_MODE must be merged or separate.");
  return mode;
}

function parseSpeculativeHandoff(value: string | undefined): boolean {
  const mode = value?.trim().toLowerCase() || "off";
  if (mode !== "off" && mode !== "on") throw new Error("INTERVIEW_SPECULATIVE_HANDOFF must be off or on.");
  return mode === "on";
}

export function loadThinkingConfig(environment = process.env): ThinkingConfig {
  const model = environment.INTERVIEW_REASONING_MODEL?.trim() || defaultThinkingModel;
  return {
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    model,
    reportModel: environment.INTERVIEW_REPORT_MODEL?.trim() || model,
    timeoutMs: parsePositiveNumber(environment.INTERVIEW_REASONING_TIMEOUT_MS, defaultThinkingTimeoutMs),
    orchestrationTimeoutMs: parsePositiveNumber(environment.INTERVIEW_ORCHESTRATION_TIMEOUT_MS, defaultOrchestrationTimeoutMs),
    orchestrationHedgeAfterMs: parseNonNegativeNumber(environment.INTERVIEW_ORCHESTRATION_HEDGE_AFTER_MS, defaultOrchestrationHedgeAfterMs),
    bridgeTimeoutMs: normalizeBridgeTimeout(environment.INTERVIEW_BRIDGE_TIMEOUT_MS),
    bridgeMode: parseBridgeMode(environment.INTERVIEW_BRIDGE_MODE),
    reportTimeoutMs: parseReportTimeout(environment.INTERVIEW_REPORT_TIMEOUT_MS),
    diagnosticsEnabled: environment.INTERVIEW_REASONING_DIAGNOSTICS?.trim().toLowerCase() === "true",
    speculativeHandoffEnabled: parseSpeculativeHandoff(environment.INTERVIEW_SPECULATIVE_HANDOFF),
  };
}
