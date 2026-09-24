import { TranscriptionUnavailableError } from "./errors.js";
import type { AudioFormat, TranscriptionProvider, TranscriptionResult, TranscriptionService } from "./types.js";

type OpenRouterWhisperTranscriptionServiceOptions = {
  key: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
};

type OpenRouterResponse = { text?: string };

const modelForProvider: Record<Exclude<TranscriptionProvider, "azure">, string> = {
  "whisper-large-v3": "openai/whisper-large-v3",
  "whisper-large-v3-turbo": "openai/whisper-large-v3-turbo",
};

export class OpenRouterWhisperTranscriptionService implements TranscriptionService {
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: OpenRouterWhisperTranscriptionServiceOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  availableProviders(): TranscriptionProvider[] {
    return ["whisper-large-v3", "whisper-large-v3-turbo"];
  }

  async transcribe(audio: Buffer, provider: TranscriptionProvider, format: AudioFormat = "wav"): Promise<TranscriptionResult> {
    if (provider === "azure") throw new TranscriptionUnavailableError("This transcription provider is not configured.");

    try {
      const response = await this.fetchImplementation("https://openrouter.ai/api/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelForProvider[provider],
          input_audio: { data: audio.toString("base64"), format },
          language: "en",
          temperature: 0,
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });

      if (!response.ok) throw new TranscriptionUnavailableError(`OpenRouter returned HTTP ${response.status}.`);
      const result = await response.json() as OpenRouterResponse;
      const transcript = result.text?.trim();
      if (!transcript) throw new TranscriptionUnavailableError("OpenRouter could not recognize a response in this recording.");
      return { provider, transcript };
    } catch (error) {
      if (error instanceof TranscriptionUnavailableError) throw error;
      throw new TranscriptionUnavailableError("OpenRouter transcription is unavailable right now.", { cause: error });
    }
  }
}
