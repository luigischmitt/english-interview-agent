import type { SpeechConfig } from "./config.js";
import { FakeSpeechProvider } from "./fake-speech-provider.js";
import { KokoroSpeechProvider } from "./kokoro-speech-provider.js";
import type { SpeechProvider } from "./types.js";

export function createSpeechProvider(config: SpeechConfig): SpeechProvider {
  if (config.provider === "kokoro") {
    return new KokoroSpeechProvider({
      baseUrl: config.kokoroBaseUrl,
      timeoutMs: config.kokoroTimeoutMs,
    });
  }

  return new FakeSpeechProvider();
}
