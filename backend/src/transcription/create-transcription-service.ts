import type { TranscriptionConfig } from "./config.js";
import { AzureSpeechTranscriptionService } from "./azure-speech-transcription-service.js";
import { TranscriptionUnavailableError } from "./errors.js";
import type { TranscriptionResult, TranscriptionService } from "./types.js";

class UnconfiguredTranscriptionService implements TranscriptionService {
  async transcribe(_audio: Buffer): Promise<TranscriptionResult> {
    throw new TranscriptionUnavailableError("Speech transcription is not configured on this server.");
  }
}

export function createTranscriptionService(config: TranscriptionConfig): TranscriptionService {
  if (!config.azureSpeechKey || !config.azureSpeechRegion) return new UnconfiguredTranscriptionService();

  return new AzureSpeechTranscriptionService({
    key: config.azureSpeechKey,
    region: config.azureSpeechRegion,
    timeoutMs: config.timeoutMs,
  });
}
