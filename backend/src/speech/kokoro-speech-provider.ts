import { SpeechProviderUnavailableError } from "./errors.js";
import type {
  SpeechProvider,
  SpeechProviderHealth,
  SpeechSynthesisRequest,
  SynthesizedSpeech,
} from "./types.js";

type KokoroSpeechProviderOptions = {
  baseUrl: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
};

export class KokoroSpeechProvider implements SpeechProvider {
  readonly name = "kokoro";

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor({ baseUrl, timeoutMs, fetchImplementation = fetch }: KokoroSpeechProviderOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.fetchImplementation = fetchImplementation;
  }

  async synthesize(request: SpeechSynthesisRequest, signal?: AbortSignal): Promise<SynthesizedSpeech> {
    return this.request("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: request.text,
        voice: request.voice,
        response_format: request.format,
        speed: request.speed,
      }),
    }, signal, async (response, requestSignal) => {
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new SpeechProviderUnavailableError(`Kokoro returned HTTP ${response.status}.`);
      }
      return {
        audio: await readAudioBody(response, requestSignal),
        contentType: response.headers.get("content-type") ?? "audio/mpeg",
      };
    });
  }

  async health(): Promise<SpeechProviderHealth> {
    return this.request("/health", { method: "GET" }, undefined, async (response) => ({
      status: response.ok ? "ready" : "unavailable",
    }));
  }

  private async request<T>(path: string, init: RequestInit, parentSignal: AbortSignal | undefined, readResponse: (response: Response, signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(parentSignal?.reason);
    const timeout = setTimeout(() => controller.abort(new Error("Kokoro request timed out.")), this.timeoutMs);
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
    if (parentSignal?.aborted) abortFromParent();

    try {
      const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      if (parentSignal?.aborted) {
        await response.body?.cancel().catch(() => undefined);
        throw parentSignal.reason ?? new DOMException("Aborted", "AbortError");
      }
      return await readResponse(response, controller.signal);
    } catch (error) {
      if (parentSignal?.aborted) throw error;
      if (error instanceof SpeechProviderUnavailableError) throw error;
      throw new SpeechProviderUnavailableError("Kokoro is unavailable.", { cause: error });
    } finally {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  }
}

async function readAudioBody(response: Response, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancelRead = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", cancelRead, { once: true });

  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.length;
    }
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

    const audio = Buffer.alloc(length);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
      chunk.fill(0);
    }
    chunks.length = 0;
    return audio;
  } catch (error) {
    for (const chunk of chunks) chunk.fill(0);
    chunks.length = 0;
    throw error;
  } finally {
    signal.removeEventListener("abort", cancelRead);
    try { reader.releaseLock(); } catch { /* A still-pending stream releases its reader when cancelled. */ }
  }
}
