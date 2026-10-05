import type { SpeechConfig } from "./config.js";
import { InterviewerSpeechPrefetcher, staticSpeechTexts } from "./interviewer-prefetcher.js";
import { SpeechCache, type SpeechCacheEvent } from "./speech-cache.js";
import type { SpeechProvider } from "./types.js";

export type SpeechServices = {
  /** Null when the cache is off (no `config.cache`, or a TTL of 0): requests then go straight to the provider. */
  cache: SpeechCache | null;
  /** Null unless prefetching is on. */
  prefetcher: InterviewerSpeechPrefetcher | null;
};

function logCacheEvent(event: SpeechCacheEvent): void {
  if (event.type === "prefetch_dropped" && event.reason === "already_present") return;
  console.info(JSON.stringify({ event: "speech_cache", ...event }));
}

export function createSpeechServices(provider: SpeechProvider, config: SpeechConfig, options: { log?: (event: SpeechCacheEvent) => void; prefetchStaticOnStart?: boolean } = {}): SpeechServices {
  const settings = config.cache;
  if (!settings || settings.ttlMs <= 0) return { cache: null, prefetcher: null };
  const staticTexts = new Set(staticSpeechTexts());
  const cache = new SpeechCache({
    provider,
    ttlMs: settings.ttlMs,
    staticTtlMs: settings.staticTtlMs,
    isStaticText: (text) => staticTexts.has(text),
    onEvent: options.log ?? logCacheEvent,
  });
  const warmable = provider as SpeechProvider & { warmConnection?: () => void };
  const prefetcher = settings.prefetch
    ? new InterviewerSpeechPrefetcher({
      cache,
      voice: config.interviewerVoice,
      speed: config.defaultSpeed,
      format: config.format,
      chunks: settings.prefetchChunks,
      ...(warmable.warmConnection ? { warmConnection: () => warmable.warmConnection?.() } : {}),
    })
    : null;
  // The fixed phrases (acknowledgements, the closing line) are synthesized once per process with the configured voice.
  if (prefetcher && options.prefetchStaticOnStart !== false && process.env.SPEECH_PREFETCH_STATIC !== "0" && config.provider !== "fake") setTimeout(() => prefetcher.prefetchStatic(), 0).unref?.();
  return { cache, prefetcher };
}
