import type { RequestHandler } from "express";

import { ThinkingServiceError } from "../thinking/errors.js";
import type { InterviewThinkingInput, ThinkingService } from "../thinking/types.js";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

function parseThinkingInput(body: unknown): InterviewThinkingInput | null {
  if (!isRecord(body) || !isText(body.currentQuestion, 500) || !isText(body.transcript, 10_000) || !isRecord(body.roleContext)) {
    return null;
  }

  const { roleContext } = body;
  if (
    !isText(roleContext.targetRole, 120)
    || (roleContext.seniority !== undefined && (typeof roleContext.seniority !== "string" || roleContext.seniority.length > 80))
    || (roleContext.focus !== undefined && (typeof roleContext.focus !== "string" || roleContext.focus.length > 80))
  ) {
    return null;
  }

  return {
    currentQuestion: body.currentQuestion.trim(),
    transcript: body.transcript.trim(),
    roleContext: {
      targetRole: roleContext.targetRole.trim(),
      ...(typeof roleContext.seniority === "string" ? { seniority: roleContext.seniority.trim() } : {}),
      ...(typeof roleContext.focus === "string" ? { focus: roleContext.focus.trim() } : {}),
    },
  };
}

export function createThinkingController(service: ThinkingService | null): RequestHandler {
  return async (request, response) => {
    if (!service) {
      response.status(503).json({
        error: { code: "THINKING_NOT_CONFIGURED", message: "The reasoning service is not configured on this server." },
      });
      return;
    }

    const input = parseThinkingInput(request.body);
    if (!input) {
      response.status(400).json({
        error: {
          code: "INVALID_THINKING_REQUEST",
          message: "currentQuestion, transcript, and roleContext.targetRole are required and must be within their length limits.",
        },
      });
      return;
    }

    try {
      const assessment = await service.assess(input);
      response.status(200).json(assessment);
    } catch (error) {
      if (error instanceof ThinkingServiceError) {
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }

      response.status(502).json({
        error: { code: "THINKING_PROVIDER_UNAVAILABLE", message: "The reasoning service is unavailable." },
      });
    }
  };
}
