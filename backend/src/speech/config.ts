import type { AudioFormat } from "./types.js";
import { defaultInterviewerVoice } from "./voices.js";

export type SpeechConfig = {
  provider: "fake" | "kokoro" | "openrouter" | "kokoro-openrouter";
  kokoroBaseUrl: string;
  kokoroAuth?: "none" | "gcp-id-token";
  kokoroTimeoutMs: number;
  interviewerVoice: string;
  defaultSpeed: number;
  format: AudioFormat;
  openRouter?: { apiKey: string; url: string; model: string; hedgeAfterMs: number };
  /** Only with SPEECH_PROVIDER=kokoro-openrouter: Kokoro first, OpenRouter as the hedge. */
  hybrid?: { hedgeAfterMs: number; openRouterVoice: string };
  /** Server-side cache of finished audio, joined with in-flight syntheses and prefetched from next-turn decisions. Absent = off. */
  cache?: { ttlMs: number; staticTtlMs: number; prefetch: boolean; prefetchChunks: number };
};

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Speech configuration values must be positive numbers.");
  }

  return parsed;
}

function parseHedgeAfterMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 2_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error("OPENROUTER_SPEECH_HEDGE_AFTER_MS must be an integer between 0 and 10000.");
  }
  return parsed;
}

function parseHybridHedgeAfterMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 2_500;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 30_000) {
    throw new Error("HYBRID_SPEECH_HEDGE_AFTER_MS must be an integer between 0 and 30000.");
  }
  return parsed;
}

const kokoroDefaultVoice = "af_bella+af_heart";
/** The default OpenRouter Kokoro voice (single voices only; blends are rejected upstream). Change the interviewer's voice here. */
export const openRouterDefaultVoice = defaultInterviewerVoice;

function parseIntegerInRange(name: string, value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function loadCacheConfig(environment: NodeJS.ProcessEnv): NonNullable<SpeechConfig["cache"]> {
  return {
    ttlMs: parseIntegerInRange("SPEECH_CACHE_TTL_MS", environment.SPEECH_CACHE_TTL_MS, 60_000, 0, 600_000),
    staticTtlMs: parseIntegerInRange("SPEECH_STATIC_CACHE_TTL_MS", environment.SPEECH_STATIC_CACHE_TTL_MS, 3_600_000, 0, 86_400_000),
    prefetch: (environment.SPEECH_PREFETCH?.trim() || "1") !== "0",
    prefetchChunks: parseIntegerInRange("SPEECH_PREFETCH_CHUNKS", environment.SPEECH_PREFETCH_CHUNKS, 1, 1, 4),
  };
}

export function loadSpeechConfig(environment = process.env): SpeechConfig {
  const provider = environment.SPEECH_PROVIDER ?? "fake";
  if (provider !== "fake" && provider !== "kokoro" && provider !== "openrouter" && provider !== "kokoro-openrouter") {
    throw new Error("SPEECH_PROVIDER must be 'fake', 'kokoro', 'openrouter' or 'kokoro-openrouter'.");
  }
  const hybrid = provider === "kokoro-openrouter";
  const kokoroAuth = environment.KOKORO_AUTH?.trim() || "none";
  if (kokoroAuth !== "none" && kokoroAuth !== "gcp-id-token") {
    throw new Error("KOKORO_AUTH must be 'none' or 'gcp-id-token'.");
  }
  const kokoroUrl = environment.KOKORO_URL?.trim();
  if (hybrid && !kokoroUrl) {
    throw new Error("KOKORO_URL is required when SPEECH_PROVIDER is 'kokoro-openrouter'.");
  }

  // With 'openrouter' the voice is OPENROUTER_SPEECH_VOICE (then INTERVIEWER_VOICE, then the default constant above).
  const interviewerVoice = provider === "openrouter"
    ? environment.OPENROUTER_SPEECH_VOICE?.trim() || environment.INTERVIEWER_VOICE?.trim() || openRouterDefaultVoice
    : environment.INTERVIEWER_VOICE?.trim() || kokoroDefaultVoice;
  let openRouter: SpeechConfig["openRouter"];
  let hybridConfig: SpeechConfig["hybrid"];
  if (provider === "openrouter" || hybrid) {
    const apiKey = environment.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(`OPENROUTER_API_KEY is required when SPEECH_PROVIDER is '${provider}'.`);
    }
    if (hybrid) {
      const openRouterVoice = environment.OPENROUTER_SPEECH_VOICE?.trim() || openRouterDefaultVoice;
      if (openRouterVoice.includes("+")) {
        throw new Error("OPENROUTER_SPEECH_VOICE cannot be a voice blend; use a single voice such as 'am_echo'.");
      }
      hybridConfig = { hedgeAfterMs: parseHybridHedgeAfterMs(environment.HYBRID_SPEECH_HEDGE_AFTER_MS), openRouterVoice };
    } else if (interviewerVoice.includes("+")) {
      throw new Error("OPENROUTER_SPEECH_VOICE / INTERVIEWER_VOICE cannot be a voice blend with SPEECH_PROVIDER 'openrouter'; use a single voice such as 'am_michael'.");
    }
    openRouter = {
      apiKey,
      url: environment.OPENROUTER_SPEECH_URL?.trim() || "https://openrouter.ai/api/v1/audio/speech",
      model: environment.OPENROUTER_SPEECH_MODEL?.trim() || "hexgrad/kokoro-82m",
      hedgeAfterMs: parseHedgeAfterMs(environment.OPENROUTER_SPEECH_HEDGE_AFTER_MS),
    };
  }

  return {
    provider,
    kokoroBaseUrl: kokoroUrl || environment.KOKORO_BASE_URL || "http://localhost:8880",
    kokoroAuth,
    kokoroTimeoutMs: parsePositiveNumber(environment.KOKORO_TIMEOUT_MS, 15_000),
    interviewerVoice,
    defaultSpeed: parsePositiveNumber(environment.INTERVIEWER_SPEED, 1),
    format: "mp3",
    ...(openRouter ? { openRouter } : {}),
    ...(hybridConfig ? { hybrid: hybridConfig } : {}),
    cache: loadCacheConfig(environment),
  };
}
