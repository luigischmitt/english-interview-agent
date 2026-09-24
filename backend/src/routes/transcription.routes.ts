import express, { Router } from "express";

import { createTranscriptionController } from "../controllers/transcription-controller.js";
import type { TranscriptionService } from "../transcription/types.js";

export function createTranscriptionRouter(service: TranscriptionService) {
  const transcriptionRouter = Router();
  const controller = createTranscriptionController(service);

  transcriptionRouter.get("/providers", controller.providers);
  transcriptionRouter.post("/", express.raw({ type: "audio/wav", limit: "4mb" }), controller.transcribe);

  return transcriptionRouter;
}
