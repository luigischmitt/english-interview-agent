import cors from "cors";
import express from "express";

import { resolveAccessTokenVerifier } from "./auth/resolve-verifier.js";
import type { AccessTokenVerifier } from "./auth/access-token-verifier.js";
import { requireAccessToken } from "./middlewares/require-access-token.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { notFoundHandler } from "./middlewares/not-found-handler.js";
import { getAllowedOrigins, isOriginAllowed } from "./middlewares/allowed-origins.js";
import { createApiRouter } from "./routes/index.js";
import { loadSpeechConfig, type SpeechConfig } from "./speech/config.js";
import { createSpeechProvider } from "./speech/create-speech-provider.js";
import type { SpeechProvider } from "./speech/types.js";
import { loadThinkingConfig, type ThinkingConfig } from "./thinking/config.js";
import { createThinkingService } from "./thinking/openrouter-thinking-service.js";
import { createOrchestrationService } from "./thinking/openrouter-orchestration-service.js";
import { createInterviewReportService } from "./thinking/openrouter-interview-report-service.js";
import type { InterviewOrchestrationService, InterviewReportService, ThinkingService } from "./thinking/types.js";
import { loadTranscriptionConfig, type TranscriptionConfig } from "./transcription/config.js";
import { createTranscriptionService } from "./transcription/create-transcription-service.js";
import { createPronunciationAssessmentService } from "./transcription/create-pronunciation-assessment-service.js";
import type { TranscriptionService } from "./transcription/types.js";

/** Resolved once at import so a missing SUPABASE_URL fails startup; null when BACKEND_AUTH_REQUIRED=false. */
export const defaultAccessTokenVerifier = resolveAccessTokenVerifier();
export const defaultTranscriptionConfig = loadTranscriptionConfig();
export const defaultTranscriptionService = createTranscriptionService(defaultTranscriptionConfig);
export const defaultPronunciationAssessmentService = createPronunciationAssessmentService(defaultTranscriptionConfig);

type AppDependencies = {
  speechConfig?: SpeechConfig;
  speechProvider?: SpeechProvider;
  transcriptionConfig?: TranscriptionConfig;
  transcriptionService?: TranscriptionService;
  thinkingConfig?: ThinkingConfig;
  thinkingService?: ThinkingService | null;
  orchestrationService?: InterviewOrchestrationService;
  reportService?: InterviewReportService | null;
  /** Omit for the environment default; pass null to disable authentication. */
  accessTokenVerifier?: AccessTokenVerifier | null;
  /** Receives one JSON line per accepted client audio diagnostic (defaults to console.info). */
  clientEventLogger?: (line: string) => void;
};

export function createApp({ speechConfig, speechProvider, transcriptionConfig, transcriptionService, thinkingConfig, thinkingService, orchestrationService, reportService, accessTokenVerifier, clientEventLogger }: AppDependencies = {}) {
  const resolvedSpeechConfig = speechConfig ?? loadSpeechConfig();
  const resolvedSpeechProvider = speechProvider ?? createSpeechProvider(resolvedSpeechConfig);
  const resolvedTranscriptionService = transcriptionService
    ?? (transcriptionConfig ? createTranscriptionService(transcriptionConfig) : defaultTranscriptionService);
  const resolvedThinkingConfig = thinkingConfig ?? loadThinkingConfig();
  const resolvedThinkingService = thinkingService === undefined ? createThinkingService(resolvedThinkingConfig) : thinkingService;
  const resolvedOrchestrationService = orchestrationService ?? createOrchestrationService(resolvedThinkingConfig);
  const resolvedReportService = reportService === undefined ? createInterviewReportService(resolvedThinkingConfig) : reportService;
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

  const verifier = accessTokenVerifier === undefined ? defaultAccessTokenVerifier : accessTokenVerifier;
  app.use("/api/v1", requireAccessToken(verifier, (request) => request.method === "GET" && request.path === "/speech/health"));
  app.use("/api/v1", createApiRouter(resolvedSpeechProvider, resolvedSpeechConfig, resolvedTranscriptionService, resolvedThinkingService, resolvedOrchestrationService, resolvedReportService, clientEventLogger));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
