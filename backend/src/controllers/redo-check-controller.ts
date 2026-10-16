import type { RequestHandler } from "express";
import { ThinkingServiceError } from "../thinking/errors.js";
import type { RedoCheckInput, RedoCheckService } from "../thinking/redo-check-service.js";

function parse(body: unknown): RedoCheckInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => !["question", "originalPatterns", "newAnswer"].includes(key)) || typeof value.question !== "string" || !value.question.trim() || value.question.length > 500 || typeof value.newAnswer !== "string" || !value.newAnswer.trim() || value.newAnswer.length > 5_000 || !Array.isArray(value.originalPatterns) || value.originalPatterns.length > 3) return null;
  const patterns = value.originalPatterns.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const pattern = item as Record<string, unknown>;
    if (Object.keys(pattern).some((key) => !["type", "evidence", "rephrasedExample"].includes(key)) || !["GRAMMAR", "WORD_CHOICE", "FALSE_COGNATE", "STRUCTURE"].includes(String(pattern.type)) || typeof pattern.evidence !== "string" || !pattern.evidence.trim() || pattern.evidence.length > 300 || typeof pattern.rephrasedExample !== "string" || !pattern.rephrasedExample.trim() || pattern.rephrasedExample.length > 500) return null;
    return { type: pattern.type as RedoCheckInput["originalPatterns"][number]["type"], evidence: pattern.evidence.trim(), rephrasedExample: pattern.rephrasedExample.trim() };
  });
  if (patterns.some((item) => item === null)) return null;
  return { question: value.question.trim(), originalPatterns: patterns as RedoCheckInput["originalPatterns"], newAnswer: value.newAnswer.trim() };
}

export function createRedoCheckController(service: RedoCheckService | null): RequestHandler {
  return async (request, response) => {
    const input = parse(request.body);
    if (!input) { response.status(400).json({ error: { code: "INVALID_REDO_CHECK_REQUEST", message: "Provide a question, answer and up to three original patterns." } }); return; }
    if (!service) { response.status(503).json({ error: { code: "THINKING_NOT_CONFIGURED", message: "The reasoning service is not configured on this server." } }); return; }
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort); response.once("close", abort);
    try { response.status(200).json(await service.check(input, controller.signal)); }
    catch (error) {
      if (controller.signal.aborted || response.destroyed) return;
      if (error instanceof ThinkingServiceError) { response.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
      response.status(502).json({ error: { code: "THINKING_PROVIDER_UNAVAILABLE", message: "The reasoning service is unavailable." } });
    } finally { request.off("aborted", abort); response.off("close", abort); }
  };
}
