export type AudioFormat = "mp3";

export type SpeechSynthesisRequest = {
  text: string;
  voice: string;
  speed: number;
  format: AudioFormat;
};

export type HedgeOutcome = "not_needed" | "primary_won" | "hedge_won" | "both_failed";

// Content-free details a provider may report for logging.
export type SpeechDiagnostics = { hedge?: HedgeOutcome; voiceSource?: "kokoro" | "openrouter" };

export type SynthesizedSpeech = {
  audio: Buffer;
  contentType: string;
  diagnostics?: SpeechDiagnostics;
};

export type SpeechProviderHealth = {
  status: "ready" | "unavailable";
};

export interface SpeechProvider {
  readonly name: string;
  synthesize(request: SpeechSynthesisRequest, signal?: AbortSignal): Promise<SynthesizedSpeech>;
  health(): Promise<SpeechProviderHealth>;
  /** Optional fire-and-forget wake-up of a scale-to-zero backend; never throws. */
  warmup?(): void;
}
