export const defaultThinkingModel = "mistralai/mistral-small-3.2-24b-instruct";
export const defaultThinkingTimeoutMs = 15_000;

export type ThinkingConfig = {
  openRouterApiKey: string | null;
  model: string;
  timeoutMs: number;
};

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Interview reasoning timeout must be a positive number.");
  }

  return parsed;
}

export function loadThinkingConfig(environment = process.env): ThinkingConfig {
  return {
    openRouterApiKey: environment.OPENROUTER_API_KEY?.trim() || null,
    model: environment.INTERVIEW_REASONING_MODEL?.trim() || defaultThinkingModel,
    timeoutMs: parsePositiveNumber(environment.INTERVIEW_REASONING_TIMEOUT_MS, defaultThinkingTimeoutMs),
  };
}
