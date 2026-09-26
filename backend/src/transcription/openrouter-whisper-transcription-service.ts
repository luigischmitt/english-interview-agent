import { TranscriptionUnavailableError } from "./errors.js";
import type { AudioFormat, TranscriptionProvider, TranscriptionResult, TranscriptionService, TranscriptionWord } from "./types.js";

type OpenRouterWhisperTranscriptionServiceOptions = {
  key: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  sleepImplementation?: (milliseconds: number) => Promise<void>;
};

type OpenRouterResponse = { text?: string; words?: unknown };

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

  async transcribe(audio: Buffer, provider: TranscriptionProvider, format: AudioFormat = "wav", signal?: AbortSignal): Promise<TranscriptionResult> {
    if (provider === "azure") throw new TranscriptionUnavailableError("This transcription provider is not configured.");

    try {
      const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const form = new FormData();
      form.set("model", modelForProvider[provider]);
      form.set("file", new Blob([new Uint8Array(audio)], { type: format === "wav" ? "audio/wav" : `audio/${format}` }), `response.${format}`);
      form.set("language", "en");
      form.set("temperature", "0");
      form.set("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "word");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await this.fetchImplementation("https://openrouter.ai/api/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${this.options.key}` },
          body: form,
          signal: requestSignal,
        });
        if (response.status === 429 && attempt < 2) {
          const delayMs = retryAfterMilliseconds(response.headers.get("retry-after")) ?? Math.min(2_000, 400 * (2 ** attempt));
          try {
            await response.body?.cancel();
          } catch {
            // A failed body discard should not prevent a bounded retry.
          }
          await sleepWithSignal(this.sleepImplementation, delayMs, requestSignal);
          continue;
        }
        if (!response.ok) {
          if (response.status === 429) throw new TranscriptionUnavailableError("OpenRouter returned HTTP 429 after retries.");
          throw new TranscriptionUnavailableError(`OpenRouter returned HTTP ${response.status}.`);
        }
        const result = await response.json() as OpenRouterResponse;
        const transcript = result.text?.trim();
        if (!transcript) throw new TranscriptionUnavailableError("OpenRouter could not recognize a response in this recording.");
        return { provider, transcript, words: parseWhisperWords(result.words, wavDurationSeconds(audio)) };
      }
      throw new TranscriptionUnavailableError("OpenRouter returned HTTP 429 after retries.");
    } catch (error) {
      if (error instanceof TranscriptionUnavailableError) throw error;
      throw new TranscriptionUnavailableError("OpenRouter transcription is unavailable right now.", { cause: error });
    }
  }
}

export function parseWhisperWords(value: unknown, durationSeconds: number): TranscriptionWord[] | undefined {
  if (!Array.isArray(value) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined;
  const words: TranscriptionWord[] = [];
  let previousEnd = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const word = item as { word?: unknown; start?: unknown; end?: unknown };
    if (typeof word.word !== "string" || !word.word.trim()
      || typeof word.start !== "number" || !Number.isFinite(word.start) || word.start < 0
      || typeof word.end !== "number" || !Number.isFinite(word.end) || word.end <= word.start
      || word.end > durationSeconds || word.start < previousEnd) return undefined;
    words.push({ text: word.word, start: word.start, end: word.end });
    previousEnd = word.end;
  }
  return words.length ? words : undefined;
}

function wavDurationSeconds(audio: Buffer): number {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") return 0;
  const sampleRate = audio.readUInt32LE(24);
  const bytesPerSecond = audio.readUInt32LE(28);
  const dataLength = audio.readUInt32LE(40);
  return sampleRate > 0 && bytesPerSecond > 0 ? Math.min(dataLength, audio.length - 44) / bytesPerSecond : 0;
}

function sleepWithSignal(sleep: (milliseconds: number) => Promise<void>, milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    sleep(milliseconds).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds)) return null;
  return Math.max(0, Math.min(2_000, milliseconds));
}
