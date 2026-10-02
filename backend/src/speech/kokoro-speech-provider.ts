import { SpeechProviderUnavailableError } from "./errors.js";
import type { IdTokenProvider } from "./gcp-identity-token.js";
import { readAudioBody, requestSpeechProvider } from "./provider-request.js";
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
  /** When set, every request (health included) carries `Authorization: Bearer <token>`. */
  idTokenProvider?: IdTokenProvider;
};

export class KokoroSpeechProvider implements SpeechProvider {
  readonly name = "kokoro";

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly idTokenProvider?: IdTokenProvider;

  constructor({ baseUrl, timeoutMs, fetchImplementation = fetch, idTokenProvider }: KokoroSpeechProviderOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.timeoutMs = timeoutMs;
    this.fetchImplementation = fetchImplementation;
    this.idTokenProvider = idTokenProvider;
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
    let authorizedInit = init;
    if (this.idTokenProvider) {
      const token = await this.idTokenProvider.getToken();
      authorizedInit = { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` } };
    }
    return requestSpeechProvider({
      label: "Kokoro",
      url: `${this.baseUrl}${path}`,
      init: authorizedInit,
      timeoutMs: this.timeoutMs,
      fetchImplementation: this.fetchImplementation,
      parentSignal,
      readResponse,
    });
  }
}
