import { Router } from "express";

import { createPracticeControllers } from "../controllers/practice-controller.js";
import { JobDirectionUserLimit } from "../thinking/job-direction-user-limit.js";
import type { PracticeService } from "../thinking/practice-service.js";

export function createPracticeRouter(service: PracticeService | null, limit = new JobDirectionUserLimit({ cooldownMs: 0 })) {
  const practiceRouter = Router();
  const controllers = createPracticeControllers(service, limit);
  practiceRouter.post("/themes", controllers.themes);
  practiceRouter.post("/exercises", controllers.exercises);
  practiceRouter.post("/grade", controllers.grade);
  return practiceRouter;
}
