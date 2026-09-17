import type { AudioFormat } from "./types.js";

export type SpeechConfig = {
  provider: "fake" | "kokoro";
  kokoroBaseUrl: string;
  kokoroTimeoutMs: number;
  interviewerVoice: string;
  defaultSpeed: number;
  format: AudioFormat;
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

export function loadSpeechConfig(environment = process.env): SpeechConfig {
  const provider = environment.SPEECH_PROVIDER ?? "fake";
  if (provider !== "fake" && provider !== "kokoro") {
    throw new Error("SPEECH_PROVIDER must be either 'fake' or 'kokoro'.");
  }

  return {
    provider,
    kokoroBaseUrl: environment.KOKORO_BASE_URL ?? "http://localhost:8880",
    kokoroTimeoutMs: parsePositiveNumber(environment.KOKORO_TIMEOUT_MS, 15_000),
    interviewerVoice: environment.INTERVIEWER_VOICE ?? "af_bella+af_heart",
    defaultSpeed: parsePositiveNumber(environment.INTERVIEWER_SPEED, 1),
    format: "mp3",
  };
}
