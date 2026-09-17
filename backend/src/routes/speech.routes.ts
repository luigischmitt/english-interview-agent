import { Router } from "express";

import { createSpeechController } from "../controllers/speech-controller.js";
import type { SpeechConfig } from "../speech/config.js";
import type { SpeechProvider } from "../speech/types.js";

export function createSpeechRouter(provider: SpeechProvider, config: SpeechConfig) {
  const speechRouter = Router();
  const controller = createSpeechController(provider, config);

  speechRouter.get("/health", controller.health);
  speechRouter.get("/voices", controller.voices);
  speechRouter.post("/", controller.synthesize);

  return speechRouter;
}
