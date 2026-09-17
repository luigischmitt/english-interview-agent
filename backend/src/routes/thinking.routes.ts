import { Router } from "express";

import { notImplemented } from "../controllers/not-implemented.js";

export const thinkingRouter = Router();

// The request will send an interview context for the reasoning service.
thinkingRouter.post("/", notImplemented("thinking"));
