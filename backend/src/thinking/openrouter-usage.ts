export type OpenRouterUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  costUsd: number | null;
  cachedTokens: number | null;
};

export type OpenRouterUsagePayload = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  cost?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown } | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function emptyOpenRouterUsage(): OpenRouterUsage {
  return { promptTokens: null, completionTokens: null, costUsd: null, cachedTokens: null };
}

export function parseOpenRouterUsage(value: OpenRouterUsagePayload | null | undefined): OpenRouterUsage {
  return {
    promptTokens: finiteNumber(value?.prompt_tokens),
    completionTokens: finiteNumber(value?.completion_tokens),
    costUsd: finiteNumber(value?.cost),
    cachedTokens: finiteNumber(value?.prompt_tokens_details?.cached_tokens),
  };
}

function addNullable(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

export function addOpenRouterUsage(left: OpenRouterUsage, right: OpenRouterUsage): OpenRouterUsage {
  return {
    promptTokens: addNullable(left.promptTokens, right.promptTokens),
    completionTokens: addNullable(left.completionTokens, right.completionTokens),
    costUsd: addNullable(left.costUsd, right.costUsd),
    cachedTokens: addNullable(left.cachedTokens, right.cachedTokens),
  };
}
