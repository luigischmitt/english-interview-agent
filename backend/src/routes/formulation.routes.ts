import { Router } from "express";

import { notImplemented } from "../controllers/not-implemented.js";

export const formulationRouter = Router();

// The request will send a response draft for the English formulation service.
formulationRouter.post("/", notImplemented("formulation"));
