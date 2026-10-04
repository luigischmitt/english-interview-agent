import { Router } from "express";

import { createClientEventsController } from "../controllers/client-events-controller.js";

export function createClientEventsRouter(log?: (line: string) => void) {
  const router = Router();
  router.post("/", createClientEventsController(log));
  return router;
}
