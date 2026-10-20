import { Router } from "express";

import { createClientEventsRouter } from "./client-events.routes.js";
import { formulationRouter } from "./formulation.routes.js";
import { createSpeechRouter } from "./speech.routes.js";
import { createThinkingRouter } from "./thinking.routes.js";
import { createTranscriptionRouter } from "./transcription.routes.js";
import { createAdminRouter } from "./admin.routes.js";
import { createVoiceRouter, PracticeDailyLimit } from "./voice.routes.js";
import { AdminUsageService } from "../admin/usage-service.js";
import type { SpeechConfig } from "../speech/config.js";
import type { SpeechProvider } from "../speech/types.js";
import { createSpeechServices } from "../speech/speech-services.js";
import type { ClosingReactionService } from "../thinking/closing-reaction-service.js";
import type { SpeculativeTurnAnalysisService } from "../thinking/speculative-turn-analysis-service.js";
import type { PolishedAnswerService } from "../thinking/polished-answer-service.js";
import type { RedoCheckService } from "../thinking/redo-check-service.js";
import type { InterviewOrchestrationService, InterviewReportService, JobDirectionService, ResumeDirectionService, ThinkingService } from "../thinking/types.js";
import type { JobDirectionUserLimit } from "../thinking/job-direction-user-limit.js";
import type { TranscriptionService } from "../transcription/types.js";
import type { PronunciationAssessmentService } from "../transcription/azure-pronunciation-assessment.js";
import type { PersistedReportGenerator } from "../controllers/persisted-interview-report-controller.js";

export function createApiRouter(provider: SpeechProvider, config: SpeechConfig, transcriptionService: TranscriptionService, thinkingService: ThinkingService | null, orchestrationService: InterviewOrchestrationService, reportService: InterviewReportService | null, jobDirectionService: JobDirectionService | null, resumeDirectionService: ResumeDirectionService | null, jobDirectionUserLimit: JobDirectionUserLimit, clientEventLogger?: (line: string) => void, speculativeService: SpeculativeTurnAnalysisService | null = null, speculativeEnabled = false, closingReactionService: ClosingReactionService | null = null, polishedAnswerService: PolishedAnswerService | null = null, redoCheckService: RedoCheckService | null = null, adminUsageService: AdminUsageService = new AdminUsageService(), adminUserIds = process.env.ADMIN_USER_IDS, pronunciationAssessmentService: PronunciationAssessmentService | null = null, practiceDailyLimit: PracticeDailyLimit = new PracticeDailyLimit(), practiceLogger?: (line: string) => void, persistedReportGenerator: PersistedReportGenerator | null = null) {
  const apiRouter = Router();
  const speechServices = createSpeechServices(provider, config);

  apiRouter.use("/transcriptions", createTranscriptionRouter(transcriptionService));
  apiRouter.use("/thinking", createThinkingRouter(thinkingService, orchestrationService, reportService, jobDirectionService, resumeDirectionService, jobDirectionUserLimit, speechServices.prefetcher, speculativeService, speculativeEnabled, closingReactionService, polishedAnswerService, redoCheckService, persistedReportGenerator));
  apiRouter.use("/voice", createVoiceRouter(pronunciationAssessmentService, practiceDailyLimit, practiceLogger));
  apiRouter.use("/formulations", formulationRouter);
  apiRouter.use("/client-events", createClientEventsRouter(clientEventLogger));
  apiRouter.use("/admin", createAdminRouter(adminUsageService, adminUserIds));
  apiRouter.use("/speech", createSpeechRouter(provider, config, speechServices.cache, speechServices.prefetcher));

  return apiRouter;
}
