import { TranscriptionUnavailableError, type TranscriptionFailureCategory } from "./errors.js";
import type { AudioFormat, SegmentTimestampResult, TranscriptionProvider, TranscriptionResult, TranscriptionService, TranscriptionWord } from "./types.js";

type OpenRouterWhisperTranscriptionServiceOptions = {
  key: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  sleepImplementation?: (milliseconds: number) => Promise<void>;
};

type OpenRouterResponse = { text?: string; words?: unknown; segments?: unknown };

/** Extra timing recovery stays short so optional vocal feedback cannot delay an interview turn. */
export const segmentTimestampRetryTimeoutMs = 12_000;

const maxHttpAttempts = 3;
const transientRetryDelayMs = 500;

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

    const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
    let attempts = 0;
    let transientRetried = false;
    const unavailable = (message: string, providerStatus: TranscriptionFailureCategory, cause?: unknown) =>
      new TranscriptionUnavailableError(message, { providerStatus, attempts, ...(cause === undefined ? {} : { cause }) });
    try {
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      // A FormData holding a Blob is re-serialized by every fetch call, so the same body can be resent.
      const form = new FormData();
      form.set("model", modelForProvider[provider]);
      form.set("file", new Blob([new Uint8Array(audio)], { type: format === "wav" ? "audio/wav" : `audio/${format}` }), `response.${format}`);
      form.set("language", "en");
      form.set("temperature", "0");
      form.set("response_format", "verbose_json");
      form.append("timestamp_granularities[]", "word");
      form.append("timestamp_granularities[]", "segment");
      // At most maxHttpAttempts requests overall: 429 retries (max 2) and the single transient retry share this cap.
      for (;;) {
        attempts += 1;
        let response: Response;
        try {
          response = await this.fetchImplementation("https://openrouter.ai/api/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${this.options.key}` },
            body: form,
            signal: requestSignal,
          });
        } catch (error) {
          // Never retry a timeout of the overall budget or a caller abort (cancel, discarded speculation, disconnect).
          if (requestSignal.aborted) throw unavailable("OpenRouter transcription is unavailable right now.", timeoutSignal.aborted ? "timeout" : "aborted", error);
          if (transientRetried || attempts >= maxHttpAttempts) throw unavailable("OpenRouter transcription is unavailable right now.", "network", error);
          transientRetried = true;
          await sleepWithSignal(this.sleepImplementation, transientRetryDelayMs, requestSignal);
          continue;
        }
        if (response.status === 429 && attempts < maxHttpAttempts) {
          const delayMs = retryAfterMilliseconds(response.headers.get("retry-after")) ?? Math.min(2_000, 400 * (2 ** (attempts - 1)));
          await discardBody(response);
          await sleepWithSignal(this.sleepImplementation, delayMs, requestSignal);
          continue;
        }
        if (response.status >= 500 && response.status <= 599 && !transientRetried && attempts < maxHttpAttempts) {
          transientRetried = true;
          await discardBody(response);
          await sleepWithSignal(this.sleepImplementation, transientRetryDelayMs, requestSignal);
          continue;
        }
        if (!response.ok) {
          const category: TranscriptionFailureCategory = response.status === 429 ? "429" : response.status >= 500 ? "5xx" : "rejected";
          throw unavailable(response.status === 429 ? "OpenRouter returned HTTP 429 after retries." : `OpenRouter returned HTTP ${response.status}.`, category);
        }
        let result: OpenRouterResponse;
        try {
          result = await response.json() as OpenRouterResponse;
        } catch (error) {
          if (requestSignal.aborted) throw unavailable("OpenRouter transcription is unavailable right now.", timeoutSignal.aborted ? "timeout" : "aborted", error);
          throw unavailable("OpenRouter transcription is unavailable right now.", "invalid_response", error);
        }
        const transcript = result.text?.trim();
        if (!transcript) throw unavailable("OpenRouter could not recognize a response in this recording.", "empty");
        const durationSeconds = wavDurationSeconds(audio);
        const words = parseWhisperWords(result.words, durationSeconds);
        const segments = parseWhisperSegments(result.segments, durationSeconds);
        const normalized: TranscriptionResult = {
          provider,
          transcript,
          words,
          segments,
        };
        Object.defineProperty(normalized, "timingDiagnostics", {
          enumerable: false,
          value: {
            wordFieldPresent: result.words !== undefined && result.words !== null,
            wordEntryCount: Array.isArray(result.words) ? result.words.length : 0,
            wordAcceptedCount: words?.length ?? 0,
            segmentFieldPresent: result.segments !== undefined && result.segments !== null,
            segmentEntryCount: Array.isArray(result.segments) ? result.segments.length : 0,
            segmentAcceptedCount: segments?.length ?? 0,
          },
        });
        if (attempts > 1) Object.defineProperty(normalized, "attempts", { enumerable: false, value: attempts });
        return normalized;
      }
    } catch (error) {
      if (error instanceof TranscriptionUnavailableError) throw error;
      // Reached when a backoff sleep is interrupted by the caller abort or the overall budget.
      throw unavailable("OpenRouter transcription is unavailable right now.", timeoutSignal.aborted ? "timeout" : signal?.aborted ? "aborted" : "network", error);
    }
  }

  async retrySegmentTimestamps(audio: Buffer, provider: TranscriptionProvider, format: AudioFormat = "wav", signal?: AbortSignal): Promise<SegmentTimestampResult> {
    if (provider === "azure") throw new TranscriptionUnavailableError("This transcription provider is not configured.");

    const timeoutSignal = AbortSignal.timeout(Math.min(this.options.timeoutMs, segmentTimestampRetryTimeoutMs));
    try {
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const form = new FormData();
      form.set("model", modelForProvider[provider]);
      form.set("file", new Blob([new Uint8Array(audio)], { type: format === "wav" ? "audio/wav" : `audio/${format}` }), `response.${format}`);
      form.set("language", "en");
      form.set("temperature", "0");
      form.set("response_format", "verbose_json");
      // Ask only for coarse timing; the primary transcript remains canonical and is never replaced.
      form.append("timestamp_granularities[]", "segment");
      const response = await this.fetchImplementation("https://openrouter.ai/api/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.key}` },
        body: form,
        signal: requestSignal,
      });
      if (!response.ok) throw new TranscriptionUnavailableError(`OpenRouter returned HTTP ${response.status}.`);
      const result = await response.json() as OpenRouterResponse;
      return { segments: parseWhisperSegments(result.segments, wavDurationSeconds(audio)) };
    } catch (error) {
      if (error instanceof TranscriptionUnavailableError) throw error;
      if (timeoutSignal.aborted) throw new TranscriptionUnavailableError("OpenRouter timing recovery timed out.", { cause: error });
      if (signal?.aborted) throw new TranscriptionUnavailableError("OpenRouter timing recovery was cancelled.", { cause: error });
      throw new TranscriptionUnavailableError("OpenRouter timing recovery is unavailable right now.", { cause: error });
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

/** Segment text and timestamps are a lower-resolution fallback when word timing is absent. */
export function parseWhisperSegments(value: unknown, durationSeconds: number): TranscriptionWord[] | undefined {
  if (!Array.isArray(value) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return undefined;
  const segments: TranscriptionWord[] = [];
  let previousEnd = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const segment = item as { text?: unknown; start?: unknown; end?: unknown };
    if (typeof segment.text !== "string" || !segment.text.trim()
      || typeof segment.start !== "number" || !Number.isFinite(segment.start) || segment.start < 0
      || typeof segment.end !== "number" || !Number.isFinite(segment.end) || segment.end <= segment.start
      || segment.end > durationSeconds || segment.start < previousEnd
      || segment.end - segment.start > 25) continue;
    segments.push({ text: segment.text, start: segment.start, end: segment.end });
    previousEnd = segment.end;
  }
  return segments.length ? segments : undefined;
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

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A failed body discard should not prevent a bounded retry.
  }
}
