import { SpeechProviderUnavailableError } from "./errors.js";
import { readAudioBody, requestSpeechProvider } from "./provider-request.js";
import type {
  SpeechProvider,
  SpeechProviderHealth,
  SpeechSynthesisRequest,
  SynthesizedSpeech,
} from "./types.js";

type OpenRouterSpeechProviderOptions = {
  apiKey: string;
  url: string;
  model: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
};

export class OpenRouterSpeechProvider implements SpeechProvider {
  readonly name = "openrouter";

  private readonly apiKey: string;
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor({ apiKey, url, model, timeoutMs, fetchImplementation = fetch }: OpenRouterSpeechProviderOptions) {
    this.apiKey = apiKey;
    this.url = url;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImplementation = fetchImplementation;
  }

  async synthesize(request: SpeechSynthesisRequest, signal?: AbortSignal): Promise<SynthesizedSpeech> {
    return requestSpeechProvider({
      label: "OpenRouter speech",
      url: this.url,
      init: {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          input: request.text,
          voice: request.voice,
          response_format: request.format,
          // Only sent when changed, so the default request stays minimal (speed was verified live).
          ...(request.speed !== 1 ? { speed: request.speed } : {}),
          provider: { data_collection: "deny" },
        }),
      },
      timeoutMs: this.timeoutMs,
      fetchImplementation: this.fetchImplementation,
      parentSignal: signal,
      readResponse: async (response, requestSignal) => {
        if (!response.ok) {
          // The error body may echo the synthesized text, so only the status is kept.
          await response.body?.cancel().catch(() => undefined);
          throw new SpeechProviderUnavailableError(`OpenRouter speech returned HTTP ${response.status}.`);
        }
        return {
          audio: await readAudioBody(response, requestSignal),
          contentType: response.headers.get("content-type") ?? "audio/mpeg",
        };
      },
    });
  }

  // No network call: probing would spend paid requests, and failures already fall back to text.
  async health(): Promise<SpeechProviderHealth> {
    return { status: "ready" };
  }
}
