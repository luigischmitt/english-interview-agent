import { TranscriptionUnavailableError } from "./errors.js";
import type { AudioFormat, TranscriptionProvider, TranscriptionResult, TranscriptionService } from "./types.js";

type OpenRouterWhisperTranscriptionServiceOptions = {
  key: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  sleepImplementation?: (milliseconds: number) => Promise<void>;
};

type OpenRouterResponse = { text?: string };

const modelForProvider: Record<Exclude<TranscriptionProvider, "azure">, string> = {
  "whisper-large-v3": "openai/whisper-large-v3",
  "whisper-large-v3-turbo": "openai/whisper-large-v3-turbo",
};

export class OpenRouterWhisperTranscriptionService implements TranscriptionService {
  private readonly fetchImplementation: typeof fetch;
  private readonly sleepImplementation: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: OpenRouterWhisperTranscriptionServiceOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.sleepImplementation = options.sleepImplementation ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  availableProviders(): TranscriptionProvider[] {
    return ["whisper-large-v3", "whisper-large-v3-turbo"];
  }

  async transcribe(audio: Buffer, provider: TranscriptionProvider, format: AudioFormat = "wav"): Promise<TranscriptionResult> {
    if (provider === "azure") throw new TranscriptionUnavailableError("This transcription provider is not configured.");

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
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

        if (response.status === 429 && attempt < 2) {
          const delayMs = retryAfterMilliseconds(response.headers.get("retry-after")) ?? Math.min(2_000, 400 * (2 ** attempt));
          try {
            await response.body?.cancel();
          } catch {
            // A failed body discard should not prevent a bounded retry.
          }
          await this.sleepImplementation(delayMs);
          continue;
        }

        if (!response.ok) {
          if (response.status === 429) throw new TranscriptionUnavailableError("OpenRouter returned HTTP 429 after retries.");
          throw new TranscriptionUnavailableError(`OpenRouter returned HTTP ${response.status}.`);
        }
        const result = await response.json() as OpenRouterResponse;
        const transcript = result.text?.trim();
        if (!transcript) throw new TranscriptionUnavailableError("OpenRouter could not recognize a response in this recording.");
        return { provider, transcript };
      }
      throw new TranscriptionUnavailableError("OpenRouter returned HTTP 429 after retries.");
    } catch (error) {
      if (error instanceof TranscriptionUnavailableError) throw error;
      throw new TranscriptionUnavailableError("OpenRouter transcription is unavailable right now.", { cause: error });
    }
  }
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds)) return null;
  return Math.max(0, Math.min(2_000, milliseconds));
}
