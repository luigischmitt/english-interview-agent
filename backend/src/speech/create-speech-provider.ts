import type { SpeechConfig } from "./config.js";
import { FakeSpeechProvider } from "./fake-speech-provider.js";
import { KokoroSpeechProvider } from "./kokoro-speech-provider.js";
import { OpenRouterSpeechProvider } from "./openrouter-speech-provider.js";
import type { SpeechProvider } from "./types.js";

export function createSpeechProvider(config: SpeechConfig): SpeechProvider {
  if (config.provider === "kokoro") {
    return new KokoroSpeechProvider({
      baseUrl: config.kokoroBaseUrl,
      timeoutMs: config.kokoroTimeoutMs,
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
