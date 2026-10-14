import type { RequestHandler } from "express";
import { ThinkingServiceError } from "../thinking/errors.js";
import { parseStudyPlanInput, type StudyPlanService } from "../thinking/study-plan-service.js";

export function createStudyPlanController(service: StudyPlanService | null): RequestHandler {
  return async (request, response) => {
    const input = parseStudyPlanInput(request.body);
    if (!input) {
      response.status(400).json({ error: { code: "INVALID_STUDY_PLAN_REQUEST", message: "Provide a bounded role context and validated report findings." } });
      return;
    }
    if (input.patterns.length === 0) {
      response.status(200).json({ targets: [] });
      return;
    }
    if (!service) {
      response.status(503).json({ error: { code: "THINKING_NOT_CONFIGURED", message: "The reasoning service is not configured on this server." } });
      return;
    }
    const controller = new AbortController();
    const abortForDisconnect = () => { if (!response.writableEnded) controller.abort(); };
    request.once("aborted", abortForDisconnect);
    response.once("close", abortForDisconnect);
    try {
      response.status(200).json(await service.create(input, controller.signal));
    } catch (error) {
      if (controller.signal.aborted || response.destroyed) return;
      if (error instanceof ThinkingServiceError) {
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      response.status(502).json({ error: { code: "THINKING_PROVIDER_UNAVAILABLE", message: "The reasoning service is unavailable." } });
    } finally {
      request.off("aborted", abortForDisconnect);
      response.off("close", abortForDisconnect);
    }
  };
}
