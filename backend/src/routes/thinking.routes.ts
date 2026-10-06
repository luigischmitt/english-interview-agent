import { Router } from "express";

import { createThinkingController } from "../controllers/thinking-controller.js";
import { createJobDirectionController } from "../controllers/job-direction-controller.js";
import { createOrchestrationController } from "../controllers/orchestration-controller.js";
import { createInterviewReportConsolidationController, createInterviewReportController, createInterviewReportTurnController } from "../controllers/interview-report-controller.js";
import { createSpeculativeTurnController } from "../controllers/speculative-turn-controller.js";
import type { InterviewerSpeechPrefetcher } from "../speech/interviewer-prefetcher.js";
import type { JobDirectionUserLimit } from "../thinking/job-direction-user-limit.js";
import type { InterviewOrchestrationService, InterviewReportService, JobDirectionService, ThinkingService } from "../thinking/types.js";
import type { SpeculativeTurnAnalysisService } from "../thinking/speculative-turn-analysis-service.js";

export function createThinkingRouter(service: ThinkingService | null, orchestrationService: InterviewOrchestrationService, reportService: InterviewReportService | null, jobDirectionService: JobDirectionService | null, jobDirectionUserLimit: JobDirectionUserLimit, speechPrefetcher: InterviewerSpeechPrefetcher | null = null, speculativeService: SpeculativeTurnAnalysisService | null = null, speculativeEnabled = false) {
  const thinkingRouter = Router();
  thinkingRouter.post("/", createThinkingController(service));
  thinkingRouter.post("/job-direction", createJobDirectionController(jobDirectionService, jobDirectionUserLimit));
  thinkingRouter.post("/next-turn", createOrchestrationController(orchestrationService, speechPrefetcher));
  thinkingRouter.post("/speculative-turn", createSpeculativeTurnController(speculativeService, speculativeEnabled));
  thinkingRouter.post("/report", createInterviewReportController(reportService));
  thinkingRouter.post("/report/turn", createInterviewReportTurnController(reportService));
  thinkingRouter.post("/report/consolidate", createInterviewReportConsolidationController(reportService));
  return thinkingRouter;
}
