import type { AudioFormat } from "./types.js";

export type SpeechConfig = {
  provider: "fake" | "kokoro" | "openrouter";
  kokoroBaseUrl: string;
  kokoroTimeoutMs: number;
  interviewerVoice: string;
  defaultSpeed: number;
  format: AudioFormat;
  openRouter?: { apiKey: string; url: string; model: string; hedgeAfterMs: number };
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
  if (value === undefined || value.trim() === "") return 1_500;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error("OPENROUTER_SPEECH_HEDGE_AFTER_MS must be an integer between 0 and 10000.");
  }
  return parsed;
}

const kokoroDefaultVoice = "af_bella+af_heart";
const openRouterDefaultVoice = "af_heart";

export function loadSpeechConfig(environment = process.env): SpeechConfig {
  const provider = environment.SPEECH_PROVIDER ?? "fake";
  if (provider !== "fake" && provider !== "kokoro" && provider !== "openrouter") {
    throw new Error("SPEECH_PROVIDER must be 'fake', 'kokoro' or 'openrouter'.");
  }

  const interviewerVoice = environment.INTERVIEWER_VOICE?.trim()
    || (provider === "openrouter" ? openRouterDefaultVoice : kokoroDefaultVoice);
  let openRouter: SpeechConfig["openRouter"];
  if (provider === "openrouter") {
    const apiKey = environment.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is required when SPEECH_PROVIDER is 'openrouter'.");
    }
    if (interviewerVoice.includes("+")) {
      throw new Error("INTERVIEWER_VOICE cannot be a voice blend with SPEECH_PROVIDER 'openrouter'; use a single voice such as 'af_heart'.");
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
    kokoroBaseUrl: environment.KOKORO_BASE_URL ?? "http://localhost:8880",
    kokoroTimeoutMs: parsePositiveNumber(environment.KOKORO_TIMEOUT_MS, 15_000),
    interviewerVoice,
    defaultSpeed: parsePositiveNumber(environment.INTERVIEWER_SPEED, 1),
    format: "mp3",
    ...(openRouter ? { openRouter } : {}),
  };
}
