import { Router } from "express";

import { createThinkingController } from "../controllers/thinking-controller.js";
import { createJobDirectionController } from "../controllers/job-direction-controller.js";
import { createOrchestrationController } from "../controllers/orchestration-controller.js";
import { createInterviewReportConsolidationController, createInterviewReportController, createInterviewReportTurnController } from "../controllers/interview-report-controller.js";
import { createSpeculativeTurnController, createSpeculativeTurnStatusController } from "../controllers/speculative-turn-controller.js";
import { createClosingReactionController } from "../controllers/closing-reaction-controller.js";
import { createResumeDirectionHandlers } from "../controllers/resume-direction-controller.js";
import type { InterviewerSpeechPrefetcher } from "../speech/interviewer-prefetcher.js";
import type { JobDirectionUserLimit } from "../thinking/job-direction-user-limit.js";
import type { InterviewOrchestrationService, InterviewReportService, JobDirectionService, ResumeDirectionService, ThinkingService } from "../thinking/types.js";
import type { ClosingReactionService } from "../thinking/closing-reaction-service.js";
import type { SpeculativeTurnAnalysisService } from "../thinking/speculative-turn-analysis-service.js";

export function createThinkingRouter(service: ThinkingService | null, orchestrationService: InterviewOrchestrationService, reportService: InterviewReportService | null, jobDirectionService: JobDirectionService | null, resumeDirectionService: ResumeDirectionService | null, jobDirectionUserLimit: JobDirectionUserLimit, speechPrefetcher: InterviewerSpeechPrefetcher | null = null, speculativeService: SpeculativeTurnAnalysisService | null = null, speculativeEnabled = false, closingReactionService: ClosingReactionService | null = null) {
  const thinkingRouter = Router();
  thinkingRouter.post("/", createThinkingController(service));
  thinkingRouter.post("/job-direction", createJobDirectionController(jobDirectionService, jobDirectionUserLimit));
  thinkingRouter.post("/resume-direction", ...createResumeDirectionHandlers(resumeDirectionService, jobDirectionUserLimit));
  thinkingRouter.post("/next-turn", createOrchestrationController(orchestrationService, speechPrefetcher));
  thinkingRouter.post("/speculative-turn", createSpeculativeTurnController(speculativeService, speculativeEnabled));
  thinkingRouter.get("/speculative-turn/status", createSpeculativeTurnStatusController(speculativeService, speculativeEnabled));
  thinkingRouter.post("/closing-reaction", createClosingReactionController(closingReactionService));
  thinkingRouter.post("/report", createInterviewReportController(reportService));
  thinkingRouter.post("/report/turn", createInterviewReportTurnController(reportService));
  thinkingRouter.post("/report/consolidate", createInterviewReportConsolidationController(reportService));
  return thinkingRouter;
}
