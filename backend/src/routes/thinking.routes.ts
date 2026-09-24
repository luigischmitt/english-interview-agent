import { Router } from "express";

import { createThinkingController } from "../controllers/thinking-controller.js";
import type { ThinkingService } from "../thinking/types.js";

export function createThinkingRouter(service: ThinkingService | null) {
  const thinkingRouter = Router();
  thinkingRouter.post("/", createThinkingController(service));
  return thinkingRouter;
}
