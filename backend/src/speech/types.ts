export type AudioFormat = "mp3";

export type SpeechSynthesisRequest = {
  text: string;
  voice: string;
  speed: number;
  format: AudioFormat;
};

export type SynthesizedSpeech = {
  audio: Buffer;
  contentType: string;
};

export type SpeechProviderHealth = {
  status: "ready" | "unavailable";
};

export interface SpeechProvider {
  readonly name: string;
  synthesize(request: SpeechSynthesisRequest, signal?: AbortSignal): Promise<SynthesizedSpeech>;
  health(): Promise<SpeechProviderHealth>;
}
