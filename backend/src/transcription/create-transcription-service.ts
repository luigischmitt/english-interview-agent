import type { TranscriptionConfig } from "./config.js";
import { AzureSpeechTranscriptionService } from "./azure-speech-transcription-service.js";
import { TranscriptionUnavailableError } from "./errors.js";
import { OpenRouterWhisperTranscriptionService } from "./openrouter-whisper-transcription-service.js";
import type { AudioFormat, TranscribeContext, TranscriptionProvider, TranscriptionResult, TranscriptionService } from "./types.js";

class UnconfiguredTranscriptionService implements TranscriptionService {
  availableProviders(): TranscriptionProvider[] {
    return [];
  }

  async transcribe(_audio: Buffer, _provider: TranscriptionProvider): Promise<TranscriptionResult> {
    throw new TranscriptionUnavailableError("Speech transcription is not configured on this server.");
  }
}

class ExperimentalTranscriptionService implements TranscriptionService {
  private readonly azure: AzureSpeechTranscriptionService | null;
  private readonly openRouter: OpenRouterWhisperTranscriptionService | null;

  constructor(config: TranscriptionConfig) {
    this.azure = config.azureSpeechKey && config.azureSpeechRegion
      ? new AzureSpeechTranscriptionService({ key: config.azureSpeechKey, region: config.azureSpeechRegion, timeoutMs: config.timeoutMs })
      : null;
    this.openRouter = config.openRouterApiKey
      ? new OpenRouterWhisperTranscriptionService({ key: config.openRouterApiKey, timeoutMs: config.openRouterTimeoutMs, promptEnabled: config.whisperPromptEnabled })
      : null;
  }

  availableProviders(): TranscriptionProvider[] {
    return [...(this.azure?.availableProviders() ?? []), ...(this.openRouter?.availableProviders() ?? [])];
  }

  async transcribe(audio: Buffer, provider: TranscriptionProvider, format?: AudioFormat, signal?: AbortSignal, context?: TranscribeContext): Promise<TranscriptionResult> {
    if (provider === "azure" && this.azure) return this.azure.transcribe(audio, provider);
    if ((provider === "whisper-large-v3" || provider === "whisper-large-v3-turbo") && this.openRouter) return this.openRouter.transcribe(audio, provider, format, signal, context);
    throw new TranscriptionUnavailableError("This transcription provider is not configured on this server.");
  }
}

export function createTranscriptionService(config: TranscriptionConfig): TranscriptionService {
  if (!config.azureSpeechKey && !config.openRouterApiKey) return new UnconfiguredTranscriptionService();
  return new ExperimentalTranscriptionService(config);
}
