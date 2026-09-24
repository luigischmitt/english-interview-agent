import cors from "cors";
import express from "express";

import { errorHandler } from "./middlewares/error-handler.js";
import { notFoundHandler } from "./middlewares/not-found-handler.js";
import { getAllowedOrigins, isOriginAllowed } from "./middlewares/allowed-origins.js";
import { createApiRouter } from "./routes/index.js";
import { loadSpeechConfig, type SpeechConfig } from "./speech/config.js";
import { createSpeechProvider } from "./speech/create-speech-provider.js";
import type { SpeechProvider } from "./speech/types.js";
import { loadTranscriptionConfig, type TranscriptionConfig } from "./transcription/config.js";
import { createTranscriptionService } from "./transcription/create-transcription-service.js";
import type { TranscriptionService } from "./transcription/types.js";

export const defaultTranscriptionService = createTranscriptionService(loadTranscriptionConfig());

type AppDependencies = {
  speechConfig?: SpeechConfig;
  speechProvider?: SpeechProvider;
  transcriptionConfig?: TranscriptionConfig;
  transcriptionService?: TranscriptionService;
};

export function createApp({ speechConfig, speechProvider, transcriptionConfig, transcriptionService }: AppDependencies = {}) {
  const resolvedSpeechConfig = speechConfig ?? loadSpeechConfig();
  const resolvedSpeechProvider = speechProvider ?? createSpeechProvider(resolvedSpeechConfig);
  const resolvedTranscriptionService = transcriptionService
    ?? (transcriptionConfig ? createTranscriptionService(transcriptionConfig) : defaultTranscriptionService);
  const app = express();

  app.use(
    cors({
      origin: (origin, callback) => callback(null, isOriginAllowed(origin, getAllowedOrigins())),
    }),
  );
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.use("/api/v1", createApiRouter(resolvedSpeechProvider, resolvedSpeechConfig, resolvedTranscriptionService));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
