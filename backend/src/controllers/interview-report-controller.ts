import type { RequestHandler } from "express";

import { ThinkingServiceError } from "../thinking/errors.js";
import type { InterviewReportInput, InterviewReportService } from "../thinking/types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function parseInput(body: unknown): InterviewReportInput | null {
  if (!isRecord(body) || Object.keys(body).some((key) => !["roleContext", "turns"].includes(key)) || !isRecord(body.roleContext) || !Array.isArray(body.turns)) return null;
  const role = body.roleContext;
  if (Object.keys(role).some((key) => !["targetRole", "seniority", "focus"].includes(key)) || !text(role.targetRole, 120)
    || (role.seniority !== undefined && (typeof role.seniority !== "string" || role.seniority.length > 80))
    || (role.focus !== undefined && (typeof role.focus !== "string" || role.focus.length > 80))
    || body.turns.length < 1 || body.turns.length > 30) return null;
  let totalChars = 0;
  let previousSequence = 0;
  const turns: InterviewReportInput["turns"] = [];
  for (const entry of body.turns) {
    if (!isRecord(entry) || Object.keys(entry).some((key) => !["sequenceNumber", "question", "answer"].includes(key))
      || !Number.isSafeInteger(entry.sequenceNumber) || (entry.sequenceNumber as number) <= previousSequence
      || !text(entry.question, 500) || !text(entry.answer, 5_000)) return null;
    previousSequence = entry.sequenceNumber as number;
    totalChars += entry.question.length + entry.answer.length;
    if (totalChars > 30_000) return null;
    turns.push({ sequenceNumber: previousSequence, question: entry.question.trim(), answer: entry.answer.trim() });
  }
  return {
    roleContext: {
      targetRole: role.targetRole.trim(),
      ...(typeof role.seniority === "string" ? { seniority: role.seniority.trim() } : {}),
      ...(typeof role.focus === "string" ? { focus: role.focus.trim() } : {}),
    },
    turns,
  };
}

export function createInterviewReportController(service: InterviewReportService | null): RequestHandler {
  return async (request, response) => {
    if (!service) {
      response.status(503).json({ error: { code: "THINKING_NOT_CONFIGURED", message: "The reasoning service is not configured on this server." } });
      return;
    }
    const input = parseInput(request.body);
    if (!input) {
      response.status(400).json({ error: { code: "INVALID_INTERVIEW_REPORT_REQUEST", message: "roleContext and 1–30 ordered question/answer turns are required within their length limits." } });
      return;
    }
    try {
      response.status(200).json(await service.generate(input));
    } catch (error) {
      if (error instanceof ThinkingServiceError) {
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      response.status(502).json({ error: { code: "THINKING_PROVIDER_UNAVAILABLE", message: "The reasoning service is unavailable." } });
    }
  };
}
