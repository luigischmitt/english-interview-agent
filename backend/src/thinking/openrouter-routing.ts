/**
 * Provider pinning for the OpenRouter chat calls. Parasail is the only provider of mistral-small-3.2 that caches prompts
 * (and the fastest one we measured), and OpenRouter's own `order` preference silently skips it after recent errors. So
 * every chat completion is first sent with `only: [pinned]`; when that provider is rate limited, failing or unavailable,
 * the original request (with its own routing) is sent once more, so a Parasail outage never fails a call.
 */

const chatCompletionsUrl = "https://openrouter.ai/api/v1/chat/completions";
/** 404: no endpoint for the pin (for example the provider dropped the model); 408/429/5xx: transient provider trouble. */
const fallbackStatuses = new Set([404, 408, 429, 500, 502, 503, 504]);

export const defaultPinnedProvider = "parasail";

function pinnedBody(body: string, provider: string): string | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const routing = (parsed as { provider?: Record<string, unknown> }).provider ?? {};
  // A retry that already excludes the pinned provider (for example after a degenerate output) keeps its own routing.
  const ignored = Array.isArray(routing.ignore) ? routing.ignore.map((name) => String(name).toLowerCase()) : [];
  if (ignored.includes(provider.toLowerCase())) return null;
  const { sort: _sort, order: _order, ...rest } = routing;
  return JSON.stringify({ ...parsed, provider: { ...rest, only: [provider], allow_fallbacks: false } });
}

/** Wraps `fetch` so OpenRouter chat calls try `provider` first; anything else passes through untouched. */
export function createPinnedOpenRouterFetch(provider: string | null = defaultPinnedProvider, baseFetch: typeof fetch = fetch): typeof fetch {
  if (!provider) return baseFetch;
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === "string" ? init.body : null;
    const pinned = url === chatCompletionsUrl && body !== null ? pinnedBody(body, provider) : null;
    if (pinned === null) return baseFetch(input, init);
    let response: Response;
    try {
      response = await baseFetch(input, { ...init, body: pinned });
    } catch (error) {
      // A caller's abort or timeout is final; a network failure to the pinned route falls back below.
      if (init?.signal?.aborted) throw error;
      return baseFetch(input, init);
    }
    if (!fallbackStatuses.has(response.status)) return response;
    await response.body?.cancel();
    return baseFetch(input, init);
  };
}

/** The pin used by the services' default fetch; `OPENROUTER_PINNED_PROVIDER=off` (or empty) disables it. */
export function pinnedProviderFromEnvironment(environment = process.env): string | null {
  const value = environment.OPENROUTER_PINNED_PROVIDER?.trim();
  if (value === undefined) return defaultPinnedProvider;
  return value === "" || value.toLowerCase() === "off" ? null : value;
}

export const pinnedOpenRouterFetch: typeof fetch = (input, init) => createPinnedOpenRouterFetch(pinnedProviderFromEnvironment())(input, init);
