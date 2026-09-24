import { Router } from "express";

import { formulationRouter } from "./formulation.routes.js";
import { createSpeechRouter } from "./speech.routes.js";
import { thinkingRouter } from "./thinking.routes.js";
import { createTranscriptionRouter } from "./transcription.routes.js";
import type { SpeechConfig } from "../speech/config.js";
import type { SpeechProvider } from "../speech/types.js";
import type { TranscriptionService } from "../transcription/types.js";

export function createApiRouter(provider: SpeechProvider, config: SpeechConfig, transcriptionService: TranscriptionService) {
  const apiRouter = Router();

  apiRouter.use("/transcriptions", createTranscriptionRouter(transcriptionService));
  apiRouter.use("/thinking", thinkingRouter);
  apiRouter.use("/formulations", formulationRouter);
  apiRouter.use("/speech", createSpeechRouter(provider, config));

  return apiRouter;
}
