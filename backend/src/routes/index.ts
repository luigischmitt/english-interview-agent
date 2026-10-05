import { Router } from "express";

import { createClientEventsRouter } from "./client-events.routes.js";
import { formulationRouter } from "./formulation.routes.js";
import { createSpeechRouter } from "./speech.routes.js";
import { createThinkingRouter } from "./thinking.routes.js";
import { createTranscriptionRouter } from "./transcription.routes.js";
import type { SpeechConfig } from "../speech/config.js";
import type { SpeechProvider } from "../speech/types.js";
import type { InterviewOrchestrationService, InterviewReportService, JobDirectionService, ThinkingService } from "../thinking/types.js";
import type { JobDirectionUserLimit } from "../thinking/job-direction-user-limit.js";
import type { TranscriptionService } from "../transcription/types.js";

export function createApiRouter(provider: SpeechProvider, config: SpeechConfig, transcriptionService: TranscriptionService, thinkingService: ThinkingService | null, orchestrationService: InterviewOrchestrationService, reportService: InterviewReportService | null, jobDirectionService: JobDirectionService | null, jobDirectionUserLimit: JobDirectionUserLimit, clientEventLogger?: (line: string) => void) {
  const apiRouter = Router();

  apiRouter.use("/transcriptions", createTranscriptionRouter(transcriptionService));
  apiRouter.use("/thinking", createThinkingRouter(thinkingService, orchestrationService, reportService, jobDirectionService, jobDirectionUserLimit));
  apiRouter.use("/formulations", formulationRouter);
  apiRouter.use("/client-events", createClientEventsRouter(clientEventLogger));
  apiRouter.use("/speech", createSpeechRouter(provider, config));

  return apiRouter;
}
