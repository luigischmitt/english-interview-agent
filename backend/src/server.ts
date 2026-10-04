import "dotenv/config";

import { createServer } from "node:http";

import { app, defaultAccessTokenVerifier, defaultPronunciationAssessmentService, defaultTranscriptionConfig, defaultTranscriptionService } from "./app.js";
import { loadThinkingConfig } from "./thinking/config.js";
import { OpenRouterAnswerCompletionService } from "./thinking/answer-completion-service.js";
import { attachTranscriptionWebSocket } from "./transcription/transcription-websocket.js";

const port = Number(process.env.PORT ?? 3001);

const server = createServer(app);
if (!defaultPronunciationAssessmentService) {
  const unavailableReason = !defaultTranscriptionConfig.assessmentEnabled
    ? "disabled_by_config"
    : !defaultTranscriptionConfig.azureSpeechKey ? "missing_key"
      : !defaultTranscriptionConfig.azureSpeechRegion ? "missing_region" : "unavailable";
  console.info(JSON.stringify({ event: "azure_assessment_configuration", enabled: false, reason: unavailableReason }));
}
const cartesiaRequested = defaultTranscriptionConfig.transcriptionProvider === "cartesia";
const incrementalRequested = defaultTranscriptionConfig.transcriptionProvider === "whisper-incremental";
const cartesiaApiKey = defaultTranscriptionConfig.cartesiaApiKey;
if (cartesiaRequested && !cartesiaApiKey) {
  console.info(JSON.stringify({ event: "transcription_provider", provider: "whisper", reason: "missing_cartesia_key" }));
}
const thinkingConfig = loadThinkingConfig();
const answerCompletion = defaultTranscriptionConfig.semanticEndEnabled && thinkingConfig.openRouterApiKey
  ? new OpenRouterAnswerCompletionService({ apiKey: thinkingConfig.openRouterApiKey, model: thinkingConfig.model, timeoutMs: defaultTranscriptionConfig.semanticEndTimeoutMs })
  : null;
attachTranscriptionWebSocket(server, defaultTranscriptionService, defaultPronunciationAssessmentService, {
  maxDurationMs: defaultTranscriptionConfig.streamMaxDurationMs,
  maxBytes: defaultTranscriptionConfig.streamMaxBytes,
  maxActiveSessions: defaultTranscriptionConfig.streamMaxActiveSessions,
  maxConcurrentTranscriptions: defaultTranscriptionConfig.streamMaxConcurrentTranscriptions,
  maxQueuedTranscriptions: defaultTranscriptionConfig.streamMaxQueuedTranscriptions,
  vadConfig: {
    trailingSilenceMs: defaultTranscriptionConfig.vadTrailingSilenceMs,
    finalizationGraceMs: defaultTranscriptionConfig.vadFinalizationGraceMs,
    ambientActivityHoldMs: defaultTranscriptionConfig.vadAmbientActivityHoldMs,
  },
  hedgeAfterMs: defaultTranscriptionConfig.hedgeAfterMs,
  finalizationTimeoutMs: 2 * defaultTranscriptionConfig.openRouterTimeoutMs + defaultTranscriptionConfig.assessmentTimeoutMs + 10_000,
}, incrementalRequested || (cartesiaRequested && cartesiaApiKey)
  ? { apiKey: cartesiaApiKey ?? undefined, provider: incrementalRequested ? "whisper-incremental" : "cartesia", fallbackMode: defaultTranscriptionConfig.transcriptionFallbackMode, answerGraceMs: defaultTranscriptionConfig.cartesiaAnswerGraceMs, incompleteGraceMs: defaultTranscriptionConfig.cartesiaIncompleteGraceMs, azureFromInkTurns: defaultTranscriptionConfig.azureTimingFromInkTurns, turnEndTimeoutMs: defaultTranscriptionConfig.cartesiaTurnEndTimeoutMs, model: defaultTranscriptionConfig.cartesiaModel, pauseMs: defaultTranscriptionConfig.cartesiaPauseMs, prepareAfterMs: defaultTranscriptionConfig.cartesiaPrepareAfterMs, maxPrepares: defaultTranscriptionConfig.cartesiaMaxPrepares, answerCompletion }
  : null, { verifier: defaultAccessTokenVerifier });

server.listen(port, () => {
  console.info(`Backend listening on port ${port}`);
});
