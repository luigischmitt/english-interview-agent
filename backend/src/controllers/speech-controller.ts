import type { RequestHandler } from "express";

import { SpeechProviderUnavailableError } from "../speech/errors.js";
import type { SpeechConfig } from "../speech/config.js";
import type { SpeechProvider } from "../speech/types.js";

const maxTextLength = 2_000;

type SpeechBody = {
  text?: unknown;
  speed?: unknown;
};

function invalidSpeechRequest(responseMessage: string, response: Parameters<RequestHandler>[1]) {
  response.status(400).json({
    error: {
      code: "INVALID_SPEECH_REQUEST",
      message: responseMessage,
    },
  });
}

export function createSpeechController(provider: SpeechProvider, config: SpeechConfig) {
  const synthesize: RequestHandler = async (request, response) => {
    const body = request.body as SpeechBody;
    const text = typeof body?.text === "string" ? body.text.trim() : "";

    if (!text) {
      invalidSpeechRequest("text must be a non-empty string.", response);
      return;
    }

    if (text.length > maxTextLength) {
      invalidSpeechRequest(`text must not exceed ${maxTextLength} characters.`, response);
      return;
    }

    const speed = body.speed === undefined ? config.defaultSpeed : body.speed;
    if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0.25 || speed > 4) {
      invalidSpeechRequest("speed must be a number between 0.25 and 4.", response);
      return;
    }

    try {
      const speech = await provider.synthesize({
        text,
        voice: config.interviewerVoice,
        speed,
        format: config.format,
      });

      response.status(200).contentType(speech.contentType).send(speech.audio);
    } catch (error) {
      if (error instanceof SpeechProviderUnavailableError) {
        response.status(503).json({
          error: {
            code: "SPEECH_PROVIDER_UNAVAILABLE",
            message: "The speech provider is unavailable. Try again shortly.",
          },
        });
        return;
      }

      throw error;
    }
  };

  const health: RequestHandler = async (_request, response) => {
    try {
      const providerHealth = await provider.health();
      const status = providerHealth.status === "ready" ? 200 : 503;

      response.status(status).json({
        status: providerHealth.status,
        provider: provider.name,
      });
    } catch (error) {
      if (error instanceof SpeechProviderUnavailableError) {
        response.status(503).json({ status: "unavailable", provider: provider.name });
        return;
      }

      throw error;
    }
  };

  const voices: RequestHandler = (_request, response) => {
    response.status(200).json({
      voices: [
        {
          id: "interviewer-default",
          providerVoice: config.interviewerVoice,
          label: "English Interviewer",
        },
      ],
    });
  };

  return { synthesize, health, voices };
}
