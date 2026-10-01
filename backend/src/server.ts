import "dotenv/config";

import { createServer } from "node:http";

import { app, defaultPronunciationAssessmentService, defaultTranscriptionConfig, defaultTranscriptionService } from "./app.js";
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
const cartesiaApiKey = defaultTranscriptionConfig.cartesiaApiKey;
if (cartesiaRequested && !cartesiaApiKey) {
  console.info(JSON.stringify({ event: "transcription_provider", provider: "whisper", reason: "missing_cartesia_key" }));
}
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
}, cartesiaRequested && cartesiaApiKey
  ? { apiKey: cartesiaApiKey, answerGraceMs: defaultTranscriptionConfig.cartesiaAnswerGraceMs, incompleteGraceMs: defaultTranscriptionConfig.cartesiaIncompleteGraceMs, azureFromInkTurns: defaultTranscriptionConfig.azureTimingFromInkTurns, turnEndTimeoutMs: defaultTranscriptionConfig.cartesiaTurnEndTimeoutMs }
  : null);

server.listen(port, () => {
  console.info(`Backend listening on port ${port}`);
});
