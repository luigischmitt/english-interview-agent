import "dotenv/config";

import { createServer } from "node:http";

import { app, defaultPronunciationAssessmentService, defaultTranscriptionConfig, defaultTranscriptionService } from "./app.js";
import { attachTranscriptionWebSocket } from "./transcription/transcription-websocket.js";

const port = Number(process.env.PORT ?? 3001);

const server = createServer(app);
attachTranscriptionWebSocket(server, defaultTranscriptionService, defaultPronunciationAssessmentService, {
  maxDurationMs: defaultTranscriptionConfig.streamMaxDurationMs,
  maxBytes: defaultTranscriptionConfig.streamMaxBytes,
  maxActiveSessions: defaultTranscriptionConfig.streamMaxActiveSessions,
  maxConcurrentTranscriptions: defaultTranscriptionConfig.streamMaxConcurrentTranscriptions,
  maxQueuedTranscriptions: defaultTranscriptionConfig.streamMaxQueuedTranscriptions,
  finalizationTimeoutMs: 2 * defaultTranscriptionConfig.openRouterTimeoutMs + defaultTranscriptionConfig.assessmentTimeoutMs + 10_000,
});

server.listen(port, () => {
  console.info(`Backend listening on port ${port}`);
});
