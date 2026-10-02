import type { RequestHandler } from "express";

import { SpeechProviderUnavailableError } from "../speech/errors.js";
import type { SpeechConfig } from "../speech/config.js";
import type { SpeechDiagnostics, SpeechProvider, VoiceStatus } from "../speech/types.js";

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

function logSpeechTiming(status: "ok" | "error" | "aborted", provider: string, start: number, textLength: number, diagnostics?: SpeechDiagnostics): void {
  console.info(JSON.stringify({ event: "speech_synthesis_timing", status, provider, durationMs: Math.max(0, Math.round(Date.now() - start)), textLength, ...(diagnostics?.hedge ? { hedge: diagnostics.hedge } : {}), ...(diagnostics?.voiceSource ? { voiceSource: diagnostics.voiceSource } : {}) }));
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

    const abortController = new AbortController();
    let audio: Buffer | null = null;
    let responseOwnsAudio = false;
    const clearAudio = () => {
      audio?.fill(0);
      audio = null;
    };
    const removeLifecycleListeners = () => {
      request.off("aborted", abortOnDisconnect);
      response.off("close", abortOnDisconnect);
      response.off("finish", clearOnFinish);
    };
    const abortOnDisconnect = () => {
      if (!response.writableEnded) abortController.abort();
      clearAudio();
      removeLifecycleListeners();
    };
    const clearOnFinish = () => {
      clearAudio();
      removeLifecycleListeners();
    };

    request.once("aborted", abortOnDisconnect);
    response.once("close", abortOnDisconnect);

    const start = Date.now();
    let timingLogged = false;
    const logTiming = (status: "ok" | "error" | "aborted", diagnostics?: SpeechDiagnostics) => {
      if (timingLogged) return;
      timingLogged = true;
      logSpeechTiming(status, provider.name, start, text.length, diagnostics);
    };

    try {
      const speech = await provider.synthesize({
        text,
        voice: config.interviewerVoice,
        speed,
        format: config.format,
      }, abortController.signal);
      audio = speech.audio;

      if (abortController.signal.aborted || response.destroyed || response.writableEnded) {
        clearAudio();
        logTiming("aborted", speech.diagnostics);
        return;
      }

      response.once("finish", clearOnFinish);
      responseOwnsAudio = true;
      try {
        response.status(200).contentType(speech.contentType).send(audio);
        logTiming("ok", speech.diagnostics);
      } catch (error) {
        clearOnFinish();
        throw error;
      }
    } catch (error) {
      if (abortController.signal.aborted || response.destroyed || response.writableEnded) {
        logTiming("aborted");
        return;
      }
      logTiming("error", error instanceof SpeechProviderUnavailableError ? error.diagnostics : undefined);
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
    } finally {
      if (!responseOwnsAudio) {
        clearAudio();
        removeLifecycleListeners();
      }
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

  // Wakes a scale-to-zero provider; providers without warmup answer 204.
  const warmup: RequestHandler = (_request, response) => {
    if (!provider.warmup) {
      response.status(204).end();
      return;
    }
    try { provider.warmup(); } catch { /* Warm-up is best effort. */ }
    response.status(202).end();
  };

  // Cached readiness of the interviewer voice; never blocks on the provider.
  const warmupStatus: RequestHandler = (_request, response) => {
    let voice: VoiceStatus = "ready";
    if (provider.voiceStatus) {
      try { voice = provider.voiceStatus(); } catch { voice = "unavailable"; }
    }
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json({ voice });
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

  return { synthesize, health, voices, warmup, warmupStatus };
}
