import type { RequestHandler } from "express";

import { TranscriptionUnavailableError } from "../transcription/errors.js";
import { transcriptionProviders, type TranscriptionProvider, type TranscriptionService } from "../transcription/types.js";

const maximumAudioBytes = 4 * 1024 * 1024;

function selectedProvider(value: string | undefined): TranscriptionProvider | null {
  if (!value) return "azure";
  return (transcriptionProviders as readonly string[]).includes(value) ? value as TranscriptionProvider : null;
}

export function createTranscriptionController(service: TranscriptionService): { providers: RequestHandler; transcribe: RequestHandler } {
  const providers: RequestHandler = (_request, response) => {
    response.status(200).json({ providers: service.availableProviders() });
  };

  const transcribe: RequestHandler = async (request, response) => {
    const provider = selectedProvider(request.header("x-transcription-provider") ?? undefined);
    if (!provider) {
      response.status(400).json({ error: { code: "INVALID_TRANSCRIPTION_PROVIDER", message: "Choose a supported transcription provider." } });
      return;
    }

    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({
        error: { code: "INVALID_TRANSCRIPTION_REQUEST", message: "Send a completed WAV audio recording." },
      });
      return;
    }

    if (request.body.length > maximumAudioBytes) {
      response.status(413).json({
        error: { code: "TRANSCRIPTION_AUDIO_TOO_LARGE", message: "Audio recordings must be 30 seconds or shorter." },
      });
      return;
    }

    try {
      response.status(200).json(await service.transcribe(request.body, provider));
    } catch (error) {
      if (error instanceof TranscriptionUnavailableError) {
        response.status(503).json({
          error: { code: "TRANSCRIPTION_UNAVAILABLE", message: "Speech transcription is unavailable right now. You can continue with a written answer." },
        });
        return;
      }

      throw error;
    }
  };

  return { providers, transcribe };
}
