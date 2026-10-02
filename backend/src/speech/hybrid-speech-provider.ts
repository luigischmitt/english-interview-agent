import { SpeechProviderUnavailableError } from "./errors.js";
import type {
  HedgeOutcome,
  SpeechProvider,
  SpeechProviderHealth,
  SpeechSynthesisRequest,
  SynthesizedSpeech,
} from "./types.js";

type Source = "kokoro" | "openrouter";

type HybridSpeechProviderOptions = {
  primary: SpeechProvider;
  secondary: SpeechProvider;
  /** Each provider gets its own voice: Kokoro accepts blends, OpenRouter does not. */
  primaryVoice: string;
  secondaryVoice: string;
  timeoutMs: number;
  /** Start the secondary after this delay without primary audio; 0 disables the timed hedge (fast failures still fall back). */
  hedgeAfterMs: number;
  /** Wake-up call for the scale-to-zero primary, e.g. an authenticated GET /health. */
  warmupRequest?: () => Promise<unknown>;
  warmupIntervalMs?: number;
  now?: () => number;
};

export class HybridSpeechProvider implements SpeechProvider {
  readonly name = "hybrid";

  private readonly options: HybridSpeechProviderOptions;
  private warmupInFlight = false;
  private lastWarmupAt = Number.NEGATIVE_INFINITY;

  constructor(options: HybridSpeechProviderOptions) {
    this.options = options;
  }

  async synthesize(request: SpeechSynthesisRequest, signal?: AbortSignal): Promise<SynthesizedSpeech> {
    const { primary, secondary, primaryVoice, secondaryVoice, timeoutMs, hedgeAfterMs } = this.options;
    const controllers = { primary: new AbortController(), secondary: new AbortController() };
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    let overallTimer: ReturnType<typeof setTimeout> | undefined;
    let secondaryStarted = false;
    let settled = false;
    let primaryFailed = false;
    let secondaryFailed = false;

    return new Promise<SynthesizedSpeech>((resolve, reject) => {
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(hedgeTimer);
        clearTimeout(overallTimer);
        signal?.removeEventListener("abort", onCallerAbort);
        action();
      };
      const abortBoth = (reason: unknown) => {
        controllers.primary.abort(reason);
        controllers.secondary.abort(reason);
      };
      function onCallerAbort() {
        abortBoth(signal?.reason);
        finish(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
      }
      const fail = () => {
        abortBoth(new Error("Speech synthesis failed."));
        finish(() => reject(new SpeechProviderUnavailableError("Speech providers are unavailable.", { diagnostics: { hedge: "both_failed" } })));
      };
      const win = (source: Source, speech: SynthesizedSpeech) => {
        if (settled) return;
        controllers[source === "kokoro" ? "secondary" : "primary"].abort(new Error("Another speech request answered first."));
        const hedge: HedgeOutcome = source === "openrouter" ? "hedge_won" : secondaryStarted ? "primary_won" : "not_needed";
        finish(() => resolve({ ...speech, diagnostics: { ...speech.diagnostics, hedge, voiceSource: source } }));
      };
      const run = (provider: SpeechProvider, voice: string, source: Source, attemptSignal: AbortSignal) =>
        provider.synthesize({ ...request, voice }, attemptSignal).then((speech) => {
          if (speech.audio.length === 0) throw new SpeechProviderUnavailableError("Speech provider returned no audio.");
          return speech;
        }).then((speech) => win(source, speech));

      const startSecondary = () => {
        if (settled || secondaryStarted) return;
        secondaryStarted = true;
        clearTimeout(hedgeTimer);
        run(secondary, secondaryVoice, "openrouter", controllers.secondary.signal).catch(() => {
          secondaryFailed = true;
          if (primaryFailed) fail();
        });
      };

      signal?.addEventListener("abort", onCallerAbort, { once: true });
      if (signal?.aborted) { onCallerAbort(); return; }

      overallTimer = setTimeout(fail, timeoutMs);
      run(primary, primaryVoice, "kokoro", controllers.primary.signal).catch(() => {
        primaryFailed = true;
        if (settled) return;
        if (!secondaryStarted) startSecondary();
        else if (secondaryFailed) fail();
      });
      if (hedgeAfterMs > 0) hedgeTimer = setTimeout(startSecondary, hedgeAfterMs);
    });
  }

  // No network call: health must not wake the scale-to-zero primary or spend paid requests.
  async health(): Promise<SpeechProviderHealth> {
    return { status: "ready" };
  }

  warmup(): void {
    const { warmupRequest, warmupIntervalMs = 60_000, now = Date.now } = this.options;
    if (!warmupRequest || this.warmupInFlight || now() - this.lastWarmupAt < warmupIntervalMs) return;
    this.warmupInFlight = true;
    this.lastWarmupAt = now();
    void Promise.resolve()
      .then(warmupRequest)
      .catch(() => undefined)
      .finally(() => { this.warmupInFlight = false; });
  }
}
