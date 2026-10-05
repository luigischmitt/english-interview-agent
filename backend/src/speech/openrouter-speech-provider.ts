import { SpeechProviderUnavailableError } from "./errors.js";
import { readAudioBody, requestSpeechProvider } from "./provider-request.js";
import type {
  HedgeOutcome,
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
  // Start a second request on another upstream provider after this delay; 0 disables hedging.
  hedgeAfterMs?: number;
  fetchImplementation?: typeof fetch;
};

export class OpenRouterSpeechProvider implements SpeechProvider {
  readonly name = "openrouter";

  private readonly apiKey: string;
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly hedgeAfterMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor({ apiKey, url, model, timeoutMs, hedgeAfterMs = 0, fetchImplementation = fetch }: OpenRouterSpeechProviderOptions) {
    this.apiKey = apiKey;
    this.url = url;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.hedgeAfterMs = hedgeAfterMs;
    this.fetchImplementation = fetchImplementation;
  }

  // Hedged: DeepInfra first (cheap); if it is slow or fails, Together races it and the first success wins.
  async synthesize(request: SpeechSynthesisRequest, signal?: AbortSignal): Promise<SynthesizedSpeech> {
    const startedAt = Date.now();
    const controllers = { primary: new AbortController(), hedge: new AbortController() };
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    let hedgeStarted = false;
    let settled = false;
    let primaryFailed = false;
    let hedgeFailed = false;
    let primaryError: unknown;

    return new Promise<SynthesizedSpeech>((resolve, reject) => {
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(hedgeTimer);
        signal?.removeEventListener("abort", onCallerAbort);
        action();
      };
      function onCallerAbort() {
        controllers.primary.abort(signal?.reason);
        controllers.hedge.abort(signal?.reason);
        finish(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
      }
      const win = (winner: "primary" | "hedge", speech: SynthesizedSpeech) => {
        if (settled) return;
        controllers[winner === "primary" ? "hedge" : "primary"].abort(new Error("Another speech request answered first."));
        const hedge = winner === "hedge" ? "hedge_won" : hedgeStarted ? "primary_won" : "not_needed";
        finish(() => resolve({ ...speech, diagnostics: { hedge } }));
      };
      const failBoth = () => finish(() => reject(this.withDiagnostics(primaryError, "both_failed")));

      const startHedge = () => {
        if (settled || hedgeStarted) return;
        hedgeStarted = true;
        clearTimeout(hedgeTimer);
        const remaining = Math.max(1, this.timeoutMs - (Date.now() - startedAt));
        this.attempt(request, "Together", controllers.hedge.signal, remaining).then(
          (speech) => win("hedge", speech),
          () => { hedgeFailed = true; if (primaryFailed) failBoth(); },
        );
      };

      signal?.addEventListener("abort", onCallerAbort, { once: true });
      if (signal?.aborted) { onCallerAbort(); return; }

      this.attempt(request, "DeepInfra", controllers.primary.signal, this.timeoutMs).then(
        (speech) => win("primary", speech),
        (error) => {
          primaryFailed = true;
          primaryError = error;
          if (settled) return;
          if (this.hedgeAfterMs <= 0) { finish(() => reject(error)); return; }
          if (!hedgeStarted) startHedge();
          else if (hedgeFailed) failBoth();
        },
      );
      if (this.hedgeAfterMs > 0) hedgeTimer = setTimeout(startHedge, this.hedgeAfterMs);
    });
  }

  private withDiagnostics(error: unknown, hedge: HedgeOutcome): unknown {
    if (error instanceof SpeechProviderUnavailableError) error.diagnostics = { hedge };
    return error;
  }

  private attempt(request: SpeechSynthesisRequest, upstream: string, signal: AbortSignal, timeoutMs: number): Promise<SynthesizedSpeech> {
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
          provider: { order: [upstream], allow_fallbacks: true, data_collection: "deny" },
        }),
      },
      timeoutMs,
      fetchImplementation: this.fetchImplementation,
      parentSignal: signal,
      readResponse: async (response, requestSignal) => {
        if (!response.ok) {
          // The error body may echo the synthesized text, so only the status is kept.
          await response.body?.cancel().catch(() => undefined);
          throw new SpeechProviderUnavailableError(`OpenRouter speech returned HTTP ${response.status}.`);
        }
        const audio = await readAudioBody(response, requestSignal);
        if (audio.length === 0) throw new SpeechProviderUnavailableError("OpenRouter speech returned no audio.");
        return { audio, contentType: response.headers.get("content-type") ?? "audio/mpeg" };
      },
    });
  }

  private lastWarmAt = Number.NEGATIVE_INFINITY;

  /**
   * Opens a connection to the speech host ahead of the first synthesis (free HEAD request, no audio). Node's fetch keeps
   * connections alive only for a few idle seconds, so this is called when a next-turn decision starts, a moment before
   * the utterance is synthesized. Fire and forget; throttled.
   */
  warmConnection(): void {
    const now = Date.now();
    if (now - this.lastWarmAt < 1_500) return;
    this.lastWarmAt = now;
    let origin: string;
    try { origin = new URL(this.url).origin; } catch { return; }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    timer.unref?.();
    void this.fetchImplementation(origin, { method: "HEAD", signal: controller.signal })
      .then((response) => response.body?.cancel().catch(() => undefined))
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
  }

  // No network call: probing would spend paid requests, and failures already fall back to text.
  async health(): Promise<SpeechProviderHealth> {
    return { status: "ready" };
  }
}
