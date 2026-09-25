import { Router } from "express";

import { createThinkingController } from "../controllers/thinking-controller.js";
import { createOrchestrationController } from "../controllers/orchestration-controller.js";
import { createInterviewReportController } from "../controllers/interview-report-controller.js";
import type { InterviewOrchestrationService, InterviewReportService, ThinkingService } from "../thinking/types.js";

export function createThinkingRouter(service: ThinkingService | null, orchestrationService: InterviewOrchestrationService, reportService: InterviewReportService | null) {
  const thinkingRouter = Router();
  thinkingRouter.post("/", createThinkingController(service));
  thinkingRouter.post("/next-turn", createOrchestrationController(orchestrationService));
  thinkingRouter.post("/report", createInterviewReportController(reportService));
  return thinkingRouter;
}
