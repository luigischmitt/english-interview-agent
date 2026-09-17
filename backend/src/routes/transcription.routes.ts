import { Router } from "express";

import { notImplemented } from "../controllers/not-implemented.js";

export const transcriptionRouter = Router();

// The request will receive audio and return its transcription once the provider is selected.
transcriptionRouter.post("/", notImplemented("transcription"));
