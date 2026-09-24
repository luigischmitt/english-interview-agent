import type { RequestHandler } from "express";

import { TranscriptionUnavailableError } from "../transcription/errors.js";
import type { TranscriptionService } from "../transcription/types.js";

const maximumAudioBytes = 4 * 1024 * 1024;

export function createTranscriptionController(service: TranscriptionService): { transcribe: RequestHandler } {
  const transcribe: RequestHandler = async (request, response) => {
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
      response.status(200).json(await service.transcribe(request.body));
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

  return { transcribe };
}
