import type { RequestHandler } from "express";

import { parseReportLocale, parseReportRoleContext } from "./interview-report-controller.js";
import { PolishedAnswerRequestError, type PolishedAnswerService } from "../thinking/polished-answer-service.js";
import { ThinkingServiceError } from "../thinking/errors.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createPolishedAnswerController(service: PolishedAnswerService | null): RequestHandler {
  return async (request, response) => {
    if (!service) {
      response.status(503).json({ error: { code: "THINKING_NOT_CONFIGURED", message: "The reasoning service is not configured on this server." } });
      return;
    }
    const body = request.body;
    const locale = isRecord(body) ? parseReportLocale(body.locale) : null;
    const roleContext = isRecord(body) && body.roleContext !== undefined ? parseReportRoleContext(body.roleContext) : undefined;
    if (!isRecord(body) || Object.keys(body).some((key) => !["question", "answer", "roleContext", "locale"].includes(key))
      || typeof body.question !== "string" || !body.question.trim() || body.question.length > 500
      || typeof body.answer !== "string" || !body.answer.trim() || body.answer.length > 5_000
      || locale === null || (body.roleContext !== undefined && !roleContext)) {
      response.status(400).json({ error: { code: "INVALID_POLISHED_ANSWER_REQUEST", message: "A question and answer within their length limits are required." } });
      return;
    }
    const controller = new AbortController();
    const abort = () => { if (!response.writableEnded) controller.abort(); };
    request.once("aborted", abort);
    response.once("close", abort);
    try {
      const result = await service.polish({ question: body.question.trim(), answer: body.answer.trim(), ...(roleContext ? { roleContext } : {}), ...(locale ? { locale } : {}), signal: controller.signal });
      response.status(200).json(result);
    } catch (error) {
      if (controller.signal.aborted || response.destroyed) return;
      if (error instanceof PolishedAnswerRequestError) {
        response.status(422).json({ error: { code: "ANSWER_TOO_SHORT_TO_POLISH", message: error.message } });
      } else if (error instanceof ThinkingServiceError) {
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
      } else {
        response.status(502).json({ error: { code: "THINKING_PROVIDER_UNAVAILABLE", message: "The reasoning service is unavailable." } });
      }
    } finally {
      request.off("aborted", abort);
      response.off("close", abort);
    }
  };
}
