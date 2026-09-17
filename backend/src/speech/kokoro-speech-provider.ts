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

  async synthesize(request: SpeechSynthesisRequest): Promise<SynthesizedSpeech> {
    const response = await this.request("/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: request.text,
        voice: request.voice,
        response_format: request.format,
        speed: request.speed,
      }),
    });

    if (!response.ok) {
      throw new SpeechProviderUnavailableError(`Kokoro returned HTTP ${response.status}.`);
    }

    return {
      audio: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "audio/mpeg",
    };
  }

  async health(): Promise<SpeechProviderHealth> {
    const response = await this.request("/health", { method: "GET" });

    return { status: response.ok ? "ready" : "unavailable" };
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImplementation(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new SpeechProviderUnavailableError("Kokoro is unavailable.", { cause: error });
    }
  }
}
