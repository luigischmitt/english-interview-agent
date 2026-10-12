import { Router } from "express";

import { createPracticeControllers } from "../controllers/practice-controller.js";
import { JobDirectionUserLimit } from "../thinking/job-direction-user-limit.js";
import type { PracticeService } from "../thinking/practice-service.js";

/** Theme grouping (background, slow) and exercises/grading (interactive) have separate per-user leases so one never blocks the other. */
export function createPracticeRouter(service: PracticeService | null, themesLimit = new JobDirectionUserLimit({ cooldownMs: 0 }), practiceLimit = new JobDirectionUserLimit({ cooldownMs: 0 })) {
  const practiceRouter = Router();
  const controllers = createPracticeControllers(service, themesLimit, practiceLimit);
  practiceRouter.post("/themes", controllers.themes);
  practiceRouter.post("/exercises", controllers.exercises);
  practiceRouter.post("/grade", controllers.grade);
  return practiceRouter;
}
