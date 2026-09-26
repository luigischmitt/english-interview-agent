import type { RequestHandler } from "express";
import type { InterviewOrchestrationInput, InterviewOrchestrationService } from "../thinking/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function parseInput(body: unknown): InterviewOrchestrationInput | null {
  if (!isRecord(body) || !validText(body.currentQuestion, 500) || !validText(body.transcript, 10_000) || !isRecord(body.roleContext)
    || !validText(body.roleContext.targetRole, 120) || typeof body.followUpUsed !== "boolean"
    || !(body.nextFixedQuestion === null || validText(body.nextFixedQuestion, 500))) return null;
  const { roleContext } = body;
  if (body.askedQuestions !== undefined && (!Array.isArray(body.askedQuestions) || body.askedQuestions.length > 30
    || body.askedQuestions.some((question) => !validText(question, 500)))) return null;
  if (body.recentAcknowledgements !== undefined && (!Array.isArray(body.recentAcknowledgements) || body.recentAcknowledgements.length > 5
    || body.recentAcknowledgements.some((acknowledgement) => !validText(acknowledgement, 120)))) return null;
  if (body.remainingFixedQuestions !== undefined && (!Array.isArray(body.remainingFixedQuestions) || body.remainingFixedQuestions.length > 30
    || body.remainingFixedQuestions.some((question) => !validText(question, 500)))) return null;
  if ((roleContext.seniority !== undefined && (typeof roleContext.seniority !== "string" || roleContext.seniority.length > 80))
    || (roleContext.focus !== undefined && (typeof roleContext.focus !== "string" || roleContext.focus.length > 80))) return null;
  const targetRole = roleContext.targetRole as string;
  return {
    currentQuestion: body.currentQuestion.trim(), transcript: body.transcript.trim(), nextFixedQuestion: body.nextFixedQuestion === null ? null : body.nextFixedQuestion.trim(), followUpUsed: body.followUpUsed,
    ...(Array.isArray(body.remainingFixedQuestions) ? { remainingFixedQuestions: body.remainingFixedQuestions.map((question) => (question as string).trim()) } : {}),
    ...(Array.isArray(body.askedQuestions) ? { askedQuestions: body.askedQuestions.map((question) => (question as string).trim()) } : {}),
    ...(Array.isArray(body.recentAcknowledgements) ? { recentAcknowledgements: body.recentAcknowledgements.map((acknowledgement) => (acknowledgement as string).trim()) } : {}),
    roleContext: { targetRole: targetRole.trim(), ...(typeof roleContext.seniority === "string" ? { seniority: roleContext.seniority.trim() } : {}), ...(typeof roleContext.focus === "string" ? { focus: roleContext.focus.trim() } : {}) },
  };
}

export function createOrchestrationController(service: InterviewOrchestrationService): RequestHandler {
  return async (request, response) => {
    const input = parseInput(request.body);
    if (!input) {
      response.status(400).json({ error: { code: "INVALID_ORCHESTRATION_REQUEST", message: "currentQuestion, transcript, roleContext.targetRole, nextFixedQuestion, and followUpUsed are required within their length limits." } });
      return;
    }
    const result = await service.decide(input);
    response.status(200).json(result);
  };
}
