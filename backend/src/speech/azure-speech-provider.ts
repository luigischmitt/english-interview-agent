import { SpeechProviderUnavailableError } from "./errors.js";
import { readAudioBody } from "./provider-request.js";
import type { SpeechProvider, SpeechProviderHealth, SpeechSynthesisRequest, SynthesizedSpeech } from "./types.js";
import { isSelectableVoice } from "./voices.js";

type AzureSpeechProviderOptions = {
  key: string;
  region: string;
  voice: string;
  timeoutMs: number;
  cooldownMs: number;
  fetchImplementation?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
};

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(); };
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(finish, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export function azureRate(speed: number): string {
  const clamped = Math.min(2, Math.max(0.5, speed));
  const percent = Math.round((clamped - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

export class AzureSpeechProvider implements SpeechProvider {
  readonly name = "azure";
  private readonly options: AzureSpeechProviderOptions;
  private readonly fetchImplementation: typeof fetch;
  private cooldownUntil = 0;

  constructor(options: AzureSpeechProviderOptions) {
    this.options = options;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async synthesize(request: SpeechSynthesisRequest, signal?: AbortSignal): Promise<SynthesizedSpeech> {
    const now = this.options.now ?? Date.now;
    if (now() < this.cooldownUntil) throw new SpeechProviderUnavailableError("Azure speech is cooling down.");
    const startedAt = now();
    const deadline = startedAt + this.options.timeoutMs;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new SpeechProviderUnavailableError("Azure speech timed out.");
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
      const timer = setTimeout(() => controller.abort(new Error("Azure speech timed out.")), remaining);
      try {
        const response = await this.fetchImplementation(`https://${this.options.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": this.options.key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            "User-Agent": "entoa-backend",
          },
          body: `<speak version='1.0' xml:lang='en-US'><voice name='${escapeXml(isSelectableVoice(request.voice) ? request.voice : this.options.voice)}'><prosody rate='${azureRate(request.speed)}'>${escapeXml(request.text)}</prosody></voice></speak>`,
          signal: controller.signal,
        });
        if (response.ok) {
          const audio = await readAudioBody(response, controller.signal);
          if (!audio.length) throw new SpeechProviderUnavailableError("Azure speech returned no audio.");
          (this.options.log ?? console.info)(JSON.stringify({ event: "speech_usage", provider: "azure", chars: request.text.length, durationMs: Math.max(0, Math.round(now() - startedAt)) }));
          return { audio, contentType: response.headers.get("content-type") ?? "audio/mpeg" };
        }
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 429) {
          if (attempt < 2) {
            const retryAfterHeader = response.headers.get("retry-after");
            const retryAfterSeconds = Number(retryAfterHeader);
            const retryAt = retryAfterHeader && !Number.isFinite(retryAfterSeconds) ? Date.parse(retryAfterHeader) : Number.NaN;
            const requestedDelay = Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1_000 : Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 0;
            const delay = Math.min(2_000, Math.max(0, requestedDelay));
            if (now() + delay < deadline) {
              if (delay > 0) await waitForRetry(delay, signal);
              continue;
            }
          }
          this.openBreaker("rate_limited");
        } else if (response.status === 401) this.openBreaker("unauthorized");
        else if (response.status === 403) this.openBreaker("quota");
        throw new SpeechProviderUnavailableError(`Azure speech returned HTTP ${response.status}.`);
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error;
        if (error instanceof SpeechProviderUnavailableError) throw error;
        throw new SpeechProviderUnavailableError("Azure speech is unavailable.", { cause: error });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    }
    throw new SpeechProviderUnavailableError("Azure speech is unavailable.");
  }

  async health(): Promise<SpeechProviderHealth> { return { status: "ready" }; }

  private openBreaker(reason: "quota" | "unauthorized" | "rate_limited"): void {
    if ((this.options.now ?? Date.now)() < this.cooldownUntil) return;
    this.cooldownUntil = (this.options.now ?? Date.now)() + this.options.cooldownMs;
    (this.options.log ?? console.info)(JSON.stringify({ event: "speech_azure_breaker", status: "open", reason, cooldownMs: this.options.cooldownMs }));
  }
}
