import { Router } from "express";

import { createThinkingController } from "../controllers/thinking-controller.js";
import { createOrchestrationController } from "../controllers/orchestration-controller.js";
import type { InterviewOrchestrationService, ThinkingService } from "../thinking/types.js";

export function createThinkingRouter(service: ThinkingService | null, orchestrationService: InterviewOrchestrationService) {
  const thinkingRouter = Router();
  thinkingRouter.post("/", createThinkingController(service));
  thinkingRouter.post("/next-turn", createOrchestrationController(orchestrationService));
  return thinkingRouter;
}
