import { Router } from "express";

import { formulationRouter } from "./formulation.routes.js";
import { thinkingRouter } from "./thinking.routes.js";
import { transcriptionRouter } from "./transcription.routes.js";

export const apiRouter = Router();

apiRouter.use("/transcriptions", transcriptionRouter);
apiRouter.use("/thinking", thinkingRouter);
apiRouter.use("/formulations", formulationRouter);
