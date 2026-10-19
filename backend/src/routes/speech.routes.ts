import { Router } from "express";

import { createSpeechController } from "../controllers/speech-controller.js";
import type { SpeechConfig } from "../speech/config.js";
import type { SpeechCache } from "../speech/speech-cache.js";
import type { InterviewerSpeechPrefetcher } from "../speech/interviewer-prefetcher.js";
import type { SpeechProvider } from "../speech/types.js";

export function createSpeechRouter(provider: SpeechProvider, config: SpeechConfig, cache: SpeechCache | null = null, prefetcher: InterviewerSpeechPrefetcher | null = null) {
  const speechRouter = Router();
  const controller = createSpeechController(provider, config, cache, prefetcher);

  speechRouter.get("/health", controller.health);
  speechRouter.get("/voices", controller.voices);
  speechRouter.post("/", controller.synthesize);
  speechRouter.post("/warmup", controller.warmup);
  speechRouter.get("/warmup-status", controller.warmupStatus);

  return speechRouter;
}
