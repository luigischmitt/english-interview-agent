import { Router } from "express";

import { createClientEventsRouter } from "./client-events.routes.js";
import { formulationRouter } from "./formulation.routes.js";
import { createSpeechRouter } from "./speech.routes.js";
import { createThinkingRouter } from "./thinking.routes.js";
import { createTranscriptionRouter } from "./transcription.routes.js";
import type { SpeechConfig } from "../speech/config.js";
import type { SpeechProvider } from "../speech/types.js";
import { createSpeechServices } from "../speech/speech-services.js";
import type { ClosingReactionService } from "../thinking/closing-reaction-service.js";
import type { SpeculativeTurnAnalysisService } from "../thinking/speculative-turn-analysis-service.js";
import type { InterviewOrchestrationService, InterviewReportService, JobDirectionService, ResumeDirectionService, ThinkingService } from "../thinking/types.js";
import type { JobDirectionUserLimit } from "../thinking/job-direction-user-limit.js";
import type { TranscriptionService } from "../transcription/types.js";

export function createApiRouter(provider: SpeechProvider, config: SpeechConfig, transcriptionService: TranscriptionService, thinkingService: ThinkingService | null, orchestrationService: InterviewOrchestrationService, reportService: InterviewReportService | null, jobDirectionService: JobDirectionService | null, resumeDirectionService: ResumeDirectionService | null, jobDirectionUserLimit: JobDirectionUserLimit, clientEventLogger?: (line: string) => void, speculativeService: SpeculativeTurnAnalysisService | null = null, speculativeEnabled = false, closingReactionService: ClosingReactionService | null = null) {
  const apiRouter = Router();
  const speechServices = createSpeechServices(provider, config);

  apiRouter.use("/transcriptions", createTranscriptionRouter(transcriptionService));
  apiRouter.use("/thinking", createThinkingRouter(thinkingService, orchestrationService, reportService, jobDirectionService, resumeDirectionService, jobDirectionUserLimit, speechServices.prefetcher, speculativeService, speculativeEnabled, closingReactionService));
  apiRouter.use("/formulations", formulationRouter);
  apiRouter.use("/client-events", createClientEventsRouter(clientEventLogger));
  apiRouter.use("/speech", createSpeechRouter(provider, config, speechServices.cache));

  return apiRouter;
}
