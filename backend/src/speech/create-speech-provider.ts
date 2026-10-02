import type { SpeechConfig } from "./config.js";
import { FakeSpeechProvider } from "./fake-speech-provider.js";
import { createGcpIdTokenProvider } from "./gcp-identity-token.js";
import { HybridSpeechProvider } from "./hybrid-speech-provider.js";
import { KokoroSpeechProvider } from "./kokoro-speech-provider.js";
import { OpenRouterSpeechProvider } from "./openrouter-speech-provider.js";
import type { SpeechProvider } from "./types.js";

export function createSpeechProvider(config: SpeechConfig): SpeechProvider {
  if (config.provider === "kokoro" || config.provider === "kokoro-openrouter") {
    const idTokenProvider = config.kokoroAuth === "gcp-id-token"
      ? createGcpIdTokenProvider({ audienceUrl: config.kokoroBaseUrl })
      : undefined;
    const kokoro = new KokoroSpeechProvider({
      baseUrl: config.kokoroBaseUrl,
      timeoutMs: config.kokoroTimeoutMs,
      ...(idTokenProvider ? { idTokenProvider } : {}),
    });
    if (config.provider === "kokoro") return kokoro;
    if (!config.openRouter || !config.hybrid) throw new Error("Hybrid speech configuration is missing.");
    return new HybridSpeechProvider({
      primary: kokoro,
      secondary: new OpenRouterSpeechProvider({
        apiKey: config.openRouter.apiKey,
        url: config.openRouter.url,
        model: config.openRouter.model,
        timeoutMs: config.kokoroTimeoutMs,
        hedgeAfterMs: config.openRouter.hedgeAfterMs,
      }),
      primaryVoice: config.interviewerVoice,
      secondaryVoice: config.hybrid.openRouterVoice,
      timeoutMs: config.kokoroTimeoutMs,
      hedgeAfterMs: config.hybrid.hedgeAfterMs,
      warmupRequest: () => kokoro.health().catch((error: unknown) => {
        // A cold start outlasts the request timeout: still warming, not failed.
        const cause = (error as { cause?: unknown } | undefined)?.cause;
        if (cause instanceof Error && /timed out/i.test(cause.message)) return { status: "warming" as const };
        throw error;
      }),
    });
  }

  if (config.provider === "openrouter") {
    if (!config.openRouter) throw new Error("OpenRouter speech configuration is missing.");
    return new OpenRouterSpeechProvider({
      apiKey: config.openRouter.apiKey,
      url: config.openRouter.url,
      model: config.openRouter.model,
      timeoutMs: config.kokoroTimeoutMs,
      hedgeAfterMs: config.openRouter.hedgeAfterMs,
    });
  }

  return new FakeSpeechProvider();
}
